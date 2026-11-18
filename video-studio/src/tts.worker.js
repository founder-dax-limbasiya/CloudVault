import * as piper from "@pbji/piper-tts-web";

const MODEL_PATHS = {
  "hi_IN-rohan-medium": "hi/hi_IN/rohan/medium/hi_IN-rohan-medium.onnx"
};

for (const [id, path] of Object.entries(MODEL_PATHS)) {
  piper.PATH_MAP[id] = path;
}

const originalFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const raw = typeof input === "string" ? input : input?.url || String(input);
  const prefix = "https://huggingface.co/diffusionstudio/piper-voices/resolve/main/";
  if (raw.startsWith(prefix + "hi/")) {
    const redirected = raw.replace(
      "https://huggingface.co/diffusionstudio/piper-voices/resolve/main/",
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
    );
    return originalFetch(redirected, init);
  }
  return originalFetch(input, init);
};

let sessionPromise;

self.onmessage = async (event) => {
  const { text, voiceId = "hi_IN-rohan-medium" } = event.data || {};
  if (!text || !text.trim()) {
    self.postMessage({ type: "error", message: "Add a script before generating audio." });
    return;
  }
  if (!MODEL_PATHS[voiceId]) {
    self.postMessage({ type: "error", message: "That voice is not configured." });
    return;
  }

  try {
    self.postMessage({ type: "status", message: "Loading the Hindi voice model…" });
    if (!sessionPromise) {
      sessionPromise = piper.TtsSession.create({
        voiceId,
        progress: (progress) => {
          self.postMessage({
            type: "progress",
            loaded: progress.loaded || 0,
            total: progress.total || 0
          });
        },
        logger: (message) => self.postMessage({ type: "log", message })
      });
    }
    const session = await sessionPromise;
    self.postMessage({ type: "status", message: "Generating narration on this device…" });
    const wav = await session.predict(text.trim());
    self.postMessage({ type: "done", audio: wav });
  } catch (error) {
    sessionPromise = undefined;
    self.postMessage({
      type: "error",
      message: error?.message || "Voice generation failed. Check your connection and try again."
    });
  }
};