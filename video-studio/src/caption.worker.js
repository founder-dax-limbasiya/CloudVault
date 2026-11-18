import { env, pipeline } from "@huggingface/transformers";

env.allowRemoteModels = true;
env.useBrowserCache = true;

let transcriberPromise = null;

async function createTranscriber() {
  const progress_callback = (event) => {
    const loaded = Number(event?.loaded) || 0;
    const total = Number(event?.total) || 0;
    const percent = total > 0 ? (loaded / total) * 100 : 0;
    self.postMessage({
      type: "progress",
      percent,
      message: event?.file ? "Downloading Whisper: " + event.file : "Loading multilingual Whisper…"
    });
  };

  const preferWebGPU = typeof navigator !== "undefined" && Boolean(navigator.gpu);
  const devices = preferWebGPU ? ["webgpu", "wasm"] : ["wasm"];
  let lastError;
  for (const device of devices) {
    try {
      self.postMessage({ type: "status", message: device === "webgpu" ? "Starting Whisper on WebGPU…" : "Starting Whisper on CPU/WASM…" });
      return await pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-tiny",
        { device, dtype: "q8", progress_callback }
      );
    } catch (error) {
      lastError = error;
      self.postMessage({ type: "status", message: "Switching speech engine after " + device + " could not start…" });
    }
  }
  throw lastError || new Error("Whisper could not start on this device.");
}

self.onmessage = async ({ data }) => {
  if (data?.type !== "transcribe" || !(data.audio instanceof Float32Array)) return;
  try {
    if (!transcriberPromise) transcriberPromise = createTranscriber();
    const transcriber = await transcriberPromise;
    self.postMessage({ type: "status", message: "Finding each spoken word and its timing…" });
    const options = {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
      task: "transcribe"
    };
    if (data.language) options.language = data.language;
    const result = await transcriber(data.audio, options);
    const words = (result?.chunks || []).map((chunk) => ({
      text: String(chunk.text || "").trim(),
      start: Number(chunk.timestamp?.[0]),
      end: Number(chunk.timestamp?.[1])
    })).filter(word => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);

    if (!words.length) throw new Error("Whisper did not return word timestamps. Try auto-detect or another language.");
    self.postMessage({ type: "done", words });
  } catch (error) {
    transcriberPromise = null;
    self.postMessage({ type: "error", message: error?.message || "Word alignment failed." });
  }
};
