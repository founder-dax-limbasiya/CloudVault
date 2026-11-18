import * as piper from "@pbji/piper-tts-web";

const MODEL_PATHS = {
  "hi_IN-rohan-medium": "hi/hi_IN/rohan/medium/hi_IN-rohan-medium.onnx"
};

for (const [id, path] of Object.entries(MODEL_PATHS)) piper.PATH_MAP[id] = path;

const originalFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const raw = typeof input === "string" ? input : input?.url || String(input);
  const prefix = "https://huggingface.co/diffusionstudio/piper-voices/resolve/main/";
  if (raw.startsWith(prefix + "hi/")) {
    return originalFetch(raw.replace(prefix, "https://huggingface.co/rhasspy/piper-voices/resolve/main/"), init);
  }
  return originalFetch(input, init);
};

let sessionPromise;

function splitText(text, limit = 620) {
  const sentences = text.match(/[^.!?।\\n]+[.!?।]?/gu) || [text];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const clean = sentence.trim();
    if (!clean) continue;
    if (clean.length > limit) {
      if (current) { chunks.push(current); current = ""; }
      const words = clean.split(/\\s+/u);
      let part = "";
      for (const word of words) {
        if (part && part.length + word.length + 1 > limit) {
          chunks.push(part);
          part = word;
        } else {
          part = part ? part + " " + word : word;
        }
      }
      if (part) chunks.push(part);
    } else if (current && current.length + clean.length + 1 > limit) {
      chunks.push(current);
      current = clean;
    } else {
      current = current ? current + " " + clean : clean;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.trim()];
}

function readAscii(view, offset, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

async function unpackWav(blob) {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("The voice engine returned an unsupported audio container.");
  }
  let fmt = null;
  let audio = null;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt ") fmt = new Uint8Array(buffer.slice(start, start + size));
    if (id === "data") audio = new Uint8Array(buffer.slice(start, start + size));
    offset = start + size + (size % 2);
  }
  if (!fmt || !audio || fmt.byteLength < 16) throw new Error("Could not read the generated WAV audio.");
  const info = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
  return {
    format: info.getUint16(0, true),
    channels: info.getUint16(2, true),
    sampleRate: info.getUint32(4, true),
    byteRate: info.getUint32(8, true),
    blockAlign: info.getUint16(12, true),
    bitsPerSample: info.getUint16(14, true),
    fmt,
    audio
  };
}

function joinWavs(parts) {
  const first = parts[0];
  if (parts.some(part =>
    part.format !== first.format ||
    part.channels !== first.channels ||
    part.sampleRate !== first.sampleRate ||
    part.bitsPerSample !== first.bitsPerSample
  )) throw new Error("Audio chunks returned different WAV formats.");

  const totalSize = parts.reduce((sum, part) => sum + part.audio.byteLength, 0);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + totalSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, first.format, true);
  view.setUint16(22, first.channels, true);
  view.setUint32(24, first.sampleRate, true);
  view.setUint32(28, first.byteRate, true);
  view.setUint16(32, first.blockAlign, true);
  view.setUint16(34, first.bitsPerSample, true);
  write(36, "data");
  view.setUint32(40, totalSize, true);
  return new Blob([header, ...parts.map(part => part.audio)], { type: "audio/wav" });
}

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
        progress: progress => self.postMessage({
          type: "progress",
          loaded: progress.loaded || 0,
          total: progress.total || 0
        }),
        logger: message => self.postMessage({ type: "log", message })
      });
    }
    const session = await sessionPromise;
    const chunks = splitText(text.trim());
    const wavParts = [];
    for (let i = 0; i < chunks.length; i++) {
      self.postMessage({
        type: "synthesis-progress",
        current: i + 1,
        total: chunks.length
      });
      const wav = await session.predict(chunks[i]);
      wavParts.push(await unpackWav(wav));
    }
    const combined = joinWavs(wavParts);
    self.postMessage({ type: "done", audio: combined });
  } catch (error) {
    sessionPromise = undefined;
    self.postMessage({
      type: "error",
      message: error?.message || "Voice generation failed. Check your connection and try again."
    });
  }
};
