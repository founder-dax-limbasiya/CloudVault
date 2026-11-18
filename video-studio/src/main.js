import "./style.css";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

const $ = (id) => document.getElementById(id);
const state = {
  worker: null,
  captionWorker: null,
  captionPromise: null,
  captionResolve: null,
  captionReject: null,
  captionWords: [],
  captionBlocks: [],
  voiceBlob: null,
  voiceBuffer: null,
  musicBuffer: null,
  masterVideoBlob: null,
  masterVideoUrl: null,
  masterDuration: 0,
  masterVideoElement: null,
  images: [],
  outputBlob: null,
  outputUrl: null,
  ffmpeg: null,
  ffmpegReady: false
};

const sampleScript = $("scriptInput").value;

function toast(message, kind = "info") {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast show " + kind;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.className = "toast", 3600);
}

function setProgress(prefix, value, message) {
  const percent = Math.max(0, Math.min(100, Math.round(value || 0)));
  $(prefix + "Progress").style.width = percent + "%";
  $(prefix + "Percent").textContent = percent + "%";
  if (message) $(prefix + "Status").textContent = message;
}

function updateCounts() {
  const text = $("scriptInput").value;
  $("charCount").textContent = text.length.toLocaleString() + " characters";
  const scenes = splitScenes(text);
  $("sceneCount").textContent = scenes.length + (scenes.length === 1 ? " scene" : " scenes");
  $("previewEmpty").classList.toggle("hidden", !text.trim());
  drawPreview();
}
function splitScenes(text) {
  const sentences = text.split(/(?<=[.!?।])\s+|\n+/u).map(s => s.trim()).filter(Boolean);
  const items = sentences.length ? sentences : (text.trim() ? [text.trim()] : []);
  const chunks = [];
  let current = "";
  for (const sentence of items) {
    if (current && current.length + sentence.length > 150) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const trial = line ? line + " " + word : word;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = trial;
  }
  if (line) lines.push(line);
  return lines;
}


function buildCaptionBlocks(words, maxChars = 16, maxDuration = 1.4) {
  const clean = (words || []).map((word) => ({
    text: String(word.text || "").trim(),
    start: Number(word.start),
    end: Number(word.end)
  })).filter(word => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);

  const blocks = [];
  let current = [];
  let blockStart = 0;
  for (const word of clean) {
    if (!current.length) {
      current = [word];
      blockStart = word.start;
      continue;
    }
    const textLength = current.reduce((sum, item) => sum + item.text.length + 1, 0);
    const span = word.end - blockStart;
    if (textLength + word.text.length > maxChars || span > maxDuration) {
      blocks.push({ start: current[0].start, end: current[current.length - 1].end, words: current });
      current = [word];
      blockStart = word.start;
    } else {
      current.push(word);
    }
  }
  if (current.length) blocks.push({ start: current[0].start, end: current[current.length - 1].end, words: current });
  return blocks;
}

function findCaptionBlock(time) {
  return state.captionBlocks.find(block =>
    time >= block.start && time <= block.end &&
    block.words.some(word => time >= word.start && time <= word.end)
  );
}

function drawKaraokeCaption(ctx, block, time, W, H) {
  if (!block) return;
  const fontSize = Math.max(22, Math.min(54, W * 0.038));
  const gap = Math.max(8, fontSize * 0.22);
  ctx.save();
  ctx.font = `800 ${fontSize}px "Noto Sans Devanagari", "Arial", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = block.words.map(word => {
    const label = /[A-Za-z]/.test(word.text) ? word.text.toLocaleUpperCase() : word.text;
    return { ...word, label, width: ctx.measureText(label).width };
  });
  const totalWidth = metrics.reduce((sum, word) => sum + word.width, 0) + gap * Math.max(0, metrics.length - 1);
  const scale = Math.min(1, (W * 0.88) / Math.max(1, totalWidth));
  const renderedWidth = totalWidth * scale;
  const centerY = H * 0.86;
  const padX = fontSize * 0.30;
  const padY = fontSize * 0.48;

  // The OpenShorts default is white text, a yellow active word and a heavy black outline.
  if (metrics.length > 1) {
    ctx.fillStyle = "rgba(7,8,12,.32)";
    ctx.beginPath();
    const boxW = Math.min(W * 0.94, renderedWidth + padX * 2);
    ctx.roundRect((W - boxW) / 2, centerY - fontSize * 0.78, boxW, fontSize * 1.56, 12);
    ctx.fill();
  }

  let x = (W - renderedWidth) / 2;
  for (const word of metrics) {
    const active = time >= word.start && time <= word.end;
    const pop = active ? 1.13 : 1;
    const drawX = x + (word.width * scale) / 2;
    ctx.save();
    ctx.translate(drawX, centerY);
    ctx.scale(scale * pop, scale * pop);
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, fontSize * 0.15);
    ctx.strokeStyle = "#050505";
    ctx.strokeText(word.label, 0, 0);
    ctx.fillStyle = active ? "#FFE500" : "#FFFFFF";
    ctx.fillText(word.label, 0, 0);
    ctx.restore();
    x += (word.width + gap) * scale;
  }
  ctx.restore();
}

function drawFrame(time = 0, duration = 1, live = false, options = {}) {
  const canvas = $("previewCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const scenes = splitScenes($("scriptInput").value);
  const total = Math.max(1, duration);
  const position = Math.max(0, Math.min(0.9999, time / total));
  const index = Math.min(Math.max(0, scenes.length - 1), Math.floor(position * Math.max(1, scenes.length)));
  const text = scenes[index] || "Your story begins here";
  const palette = [
    ["#101a2c", "#293d59"], ["#211b2a", "#603b4b"], ["#122a29", "#315d53"],
    ["#242031", "#4e3f62"], ["#191e2a", "#46566c"], ["#2c211b", "#63452d"]
  ];
  const colors = palette[index % palette.length];

  ctx.clearRect(0, 0, W, H);
  if (state.images.length) {
    const image = state.images[index % state.images.length].image;
    const zoom = 1.03 + position * 0.04;
    const scale = Math.max(W / image.width, H / image.height) * zoom;
    const sw = W / scale, sh = H / scale;
    const drift = (position - 0.5) * 0.025;
    const sx = Math.max(0, Math.min(image.width - sw, (image.width - sw) / 2 + drift * image.width));
    const sy = Math.max(0, Math.min(image.height - sh, (image.height - sh) / 2 - drift * image.height));
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, W, H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 34; i++) {
      const x = ((i * 197 + index * 71) % W);
      const y = ((i * 113 + index * 37) % H);
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255," + (0.025 + (i % 4) * 0.008) + ")";
      ctx.arc(x, y, (i % 3) * 3 + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W * 0.78, H * 0.27, Math.min(W, H) * 0.20, 0, Math.PI * 2);
    ctx.stroke();
  }

  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, "rgba(5,7,12,.28)");
  shade.addColorStop(.42, "rgba(5,7,12,.16)");
  shade.addColorStop(1, "rgba(5,7,12,.88)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  const pad = W * .075;
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,.68)";
  ctx.font = "600 " + Math.max(13, W * .014) + "px Arial, sans-serif";
  ctx.fillText("SCENEFORGE  /  CHAPTER " + String(index + 1).padStart(2, "0"), pad, H * .105);

  const hero = text.split(/\s+/).slice(0, 4).join(" ");
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 " + Math.max(28, Math.min(W * .066, H * .085)) + "px Arial, sans-serif";
  const heroLines = wrapText(ctx, hero, W * .82).slice(0, 3);
  const startY = H * .46 - (heroLines.length - 1) * H * .045;
  heroLines.forEach((line, i) => ctx.fillText(line, W / 2, startY + i * H * .09));

  if (options.includeCaptions !== false && $("captionsToggle").checked) {
    if ($("postVoiceoverToggle").checked && state.captionBlocks.length) {
      drawKaraokeCaption(ctx, findCaptionBlock(time), time, W, H);
    } else {
      const captionLines = wrapText(ctx, text, W * .80).slice(0, 3);
      const lineH = Math.max(24, H * .039);
      const boxH = captionLines.length * lineH + H * .055;
      const boxY = H * .78 - boxH / 2;
      ctx.fillStyle = "rgba(8,10,15,.72)";
      const boxW = W * .88;
      ctx.beginPath();
      ctx.roundRect((W - boxW) / 2, boxY, boxW, boxH, 16);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 " + Math.max(16, W * .026) + "px Arial, sans-serif";
      captionLines.forEach((line, i) => ctx.fillText(line, W / 2, boxY + H * .032 + (i + 1) * lineH));
    }
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,.65)";
  ctx.font = "500 " + Math.max(12, W * .012) + "px Arial, sans-serif";
  const title = $("videoTitle").value.trim().slice(0, 52);
  ctx.fillText(title || "Untitled story", pad, H * .94);

  ctx.fillStyle = "rgba(255,255,255,.24)";
  ctx.fillRect(pad, H * .965, W - pad * 2, Math.max(3, H * .004));
  ctx.fillStyle = "#e5bd87";
  ctx.fillRect(pad, H * .965, (W - pad * 2) * position, Math.max(3, H * .004));
}
function drawPreview() { drawFrame(0, 1, true); }

async function decodeAudio(blob) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return buffer;
  } finally {
    await context.close();
  }
}

function updateRenderAvailability() {
  const ready = Boolean($("scriptInput").value.trim());
  $("renderBtn").disabled = !ready;
  $("renderHint").textContent = ready
    ? "Generate the visual film first. Voiceover, music and subtitles can be edited afterwards."
    : "Add a script to start your film.";
  updatePostTrackAvailability();
}

function updatePostTrackAvailability() {
  const voiceToggle = $("postVoiceoverToggle");
  const musicToggle = $("postMusicToggle");
  const captionsToggle = $("captionsToggle");
  if (!voiceToggle || !musicToggle || !captionsToggle) return;
  voiceToggle.disabled = !state.voiceBuffer;
  musicToggle.disabled = !state.musicBuffer;
  if (!state.voiceBuffer) voiceToggle.checked = false;
  if (!state.musicBuffer) musicToggle.checked = false;
  $("syncCaptionsBtn").disabled = !state.voiceBuffer;
}


function createCaptionWorker() {
  if (state.captionWorker) return state.captionWorker;
  const worker = new Worker(new URL("./caption.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "status") {
      $("captionStatus").textContent = data.message;
    } else if (data.type === "progress") {
      const pct = Math.max(0, Math.min(100, Number(data.percent) || 0));
      setProgress("caption", pct, data.message || "Preparing word-level captions…");
    } else if (data.type === "done") {
      state.captionWords = data.words || [];
      state.captionBlocks = buildCaptionBlocks(state.captionWords);
      $("captionProgressWrap").classList.add("hidden");
      $("syncCaptionsBtn").disabled = false;
      $("syncCaptionsBtn").textContent = "↻ Re-sync captions";
      $("captionStatus").textContent = state.captionWords.length + " words aligned";
      drawPreview();
      toast("Word-synced karaoke captions are ready.", "success");
      state.captionResolve?.(state.captionWords);
      state.captionResolve = null;
      state.captionReject = null;
      state.captionPromise = null;
    } else if (data.type === "error") {
      $("captionProgressWrap").classList.add("hidden");
      $("syncCaptionsBtn").disabled = false;
      $("syncCaptionsBtn").textContent = "↻ Sync word captions";
      toast(data.message || "Caption alignment failed.", "error");
      state.captionReject?.(new Error(data.message || "Caption alignment failed."));
      state.captionResolve = null;
      state.captionReject = null;
      state.captionPromise = null;
    }
  };
  worker.onerror = (event) => {
    $("captionProgressWrap").classList.add("hidden");
    $("syncCaptionsBtn").disabled = false;
    $("syncCaptionsBtn").textContent = "↻ Sync word captions";
    const error = new Error(event.message || "Caption worker failed.");
    toast(error.message, "error");
    state.captionReject?.(error);
    state.captionResolve = null;
    state.captionReject = null;
    state.captionPromise = null;
  };
  state.captionWorker = worker;
  return worker;
}

function audioBufferTo16kMono(buffer) {
  const targetRate = 16000;
  const inputRate = buffer.sampleRate;
  const targetLength = Math.max(1, Math.floor(buffer.length * targetRate / inputRate));
  const output = new Float32Array(targetLength);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const ratio = inputRate / targetRate;
  for (let i = 0; i < targetLength; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    let mixed = 0;
    for (const channel of channels) {
      const a = channel[Math.min(left, channel.length - 1)] || 0;
      const b = channel[Math.min(left + 1, channel.length - 1)] || a;
      mixed += a + (b - a) * fraction;
    }
    output[i] = mixed / channels.length;
  }
  return output;
}

function syncCaptions() {
  if (!state.voiceBuffer) return Promise.reject(new Error("Generate or upload a voiceover first."));
  if (state.captionPromise) return state.captionPromise;
  const waveform = audioBufferTo16kMono(state.voiceBuffer);
  $("syncCaptionsBtn").disabled = true;
  $("syncCaptionsBtn").textContent = "Aligning words…";
  $("captionProgressWrap").classList.remove("hidden");
  setProgress("caption", 0, "Loading the multilingual Whisper model…");

  state.captionPromise = new Promise((resolve, reject) => {
    state.captionResolve = resolve;
    state.captionReject = reject;
    createCaptionWorker().postMessage({
      type: "transcribe",
      audio: waveform,
      language: $("captionLanguage").value
    }, [waveform.buffer]);
  });
  return state.captionPromise;
}

function setWorker() {
  if (state.worker) return state.worker;
  const worker = new Worker(new URL("./tts.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = async ({ data }) => {
    if (data.type === "status") {
      $("voiceStatus").textContent = data.message;
    } else if (data.type === "progress") {
      const pct = data.total ? (data.loaded / data.total) * 100 : 0;
      setProgress("voice", pct, "Downloading Hindi voice model…");
    } else if (data.type === "synthesis-progress") {
      const pct = data.total ? (data.current / data.total) * 100 : 0;
      setProgress("voice", pct, "Generating narration part " + data.current + " of " + data.total + "…");
    } else if (data.type === "done") {
      try {
        state.voiceBlob = data.audio;
        state.voiceBuffer = await decodeAudio(data.audio);
        state.captionWords = [];
        state.captionBlocks = [];
        const url = URL.createObjectURL(data.audio);
        $("voicePlayer").src = url;
        $("voiceDownload").href = url;
        $("voiceResult").classList.remove("hidden");
        $("voiceProgressWrap").classList.add("hidden");
        $("voiceStatus").textContent = "Voiceover ready";
        updateRenderAvailability();
        if ($("outputPanel") && !$("outputPanel").classList.contains("hidden")) {
          $("postVoiceoverToggle").checked = true;
          updatePostTrackAvailability();
        }
        toast("Hindi voiceover generated on this device.", "success");
      } catch (error) {
        toast("Audio could not be decoded: " + error.message, "error");
      } finally {
        $("generateVoice").disabled = false;
        $("generateVoice").innerHTML = '<span class="btn-icon">◖</span> Generate voiceover';
      }
    } else if (data.type === "error") {
      $("voiceProgressWrap").classList.add("hidden");
      $("generateVoice").disabled = false;
      $("generateVoice").innerHTML = '<span class="btn-icon">◖</span> Generate voiceover';
      toast(data.message || "Voice generation failed.", "error");
    }
  };
  worker.onerror = (event) => {
    $("voiceProgressWrap").classList.add("hidden");
    $("generateVoice").disabled = false;
    $("generateVoice").innerHTML = '<span class="btn-icon">◖</span> Generate voiceover';
    toast(event.message || "Voice worker failed to start.", "error");
  };
  state.worker = worker;
  return worker;
}

$("generateVoice").addEventListener("click", () => {
  const text = $("scriptInput").value.trim();
  if (!text) return toast("Paste your script first.", "error");
  if (text.length > 70000) return toast("This script is too long for one mobile voice job. Split it into chapters.", "error");
  $("generateVoice").disabled = true;
  $("generateVoice").innerHTML = '<span class="spinner"></span> Working…';
  $("voiceProgressWrap").classList.remove("hidden");
  $("voiceResult").classList.add("hidden");
  setProgress("voice", 0, "Starting the local Hindi engine…");
  setWorker().postMessage({ text, voiceId: "hi_IN-rohan-medium" });
});

$("voiceUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    state.voiceBlob = file;
    state.voiceBuffer = await decodeAudio(file);
    state.captionWords = [];
    state.captionBlocks = [];
    const url = URL.createObjectURL(file);
    $("voicePlayer").src = url;
    $("voiceDownload").href = url;
    $("voiceDownload").download = file.name;
    $("voiceResult").classList.remove("hidden");
    updateRenderAvailability();
    if ($("outputPanel") && !$("outputPanel").classList.contains("hidden")) {
      $("postVoiceoverToggle").checked = true;
      updatePostTrackAvailability();
    }
    toast("Your voiceover is ready.", "success");
  } catch (error) {
    toast("This audio format could not be opened by the browser.", "error");
  }
});

$("musicUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    state.musicBuffer = await decodeAudio(file);
    $("musicName").textContent = "♫  " + file.name;
    $("musicName").classList.remove("hidden");
    if ($("outputPanel") && !$("outputPanel").classList.contains("hidden")) {
      $("postMusicToggle").checked = true;
      updatePostTrackAvailability();
    }
    toast("Background soundtrack added.", "success");
  } catch {
    toast("This music file could not be opened.", "error");
  }
});

$("imageUpload").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []).slice(0, 12);
  state.images = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const image = new Image();
    image.src = URL.createObjectURL(file);
    await image.decode().catch(() => null);
    if (image.naturalWidth) state.images.push({ name: file.name, image, url: image.src });
  }
  const list = $("imageList");
  list.innerHTML = "";
  state.images.forEach((item) => {
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.name;
    img.title = item.name;
    list.appendChild(img);
  });
  $("previewEmpty").classList.toggle("hidden", !$("scriptInput").value.trim());
  drawPreview();
  toast(state.images.length + " visual(s) added.", "success");
});

$("scriptInput").addEventListener("input", updateCounts);
$("videoTitle").addEventListener("input", drawPreview);
$("captionsToggle").addEventListener("change", drawPreview);
["postVoiceoverToggle", "postMusicToggle", "captionsToggle"].forEach((id) => {
  $(id).addEventListener("change", () => {
    $("postEditHint").textContent = "Track settings changed. Apply edits to update the final video.";
    drawPreview();
  });
});
$("syncCaptionsBtn").addEventListener("click", () => {
  syncCaptions().catch(() => {});
});
$("applyPostEditsBtn").addEventListener("click", () => {
  renderFinalVideo().catch((error) => toast(error.message || "Could not apply the edits.", "error"));
});

$("aspectSelect").addEventListener("change", () => {
  const ratio = $("aspectSelect").value;
  const frame = $("canvasFrame");
  frame.className = "canvas-frame " + (ratio === "9:16" ? "ratio-9-16" : ratio === "1:1" ? "ratio-1-1" : "ratio-16-9");
  $("previewRatio").textContent = ratio;
  const q = Number($("qualitySelect").value);
  const sizes = ratio === "9:16" ? [720, 1280] : ratio === "1:1" ? [720, 720] : [1280, 720];
  const scale = q === 480 ? .667 : 1;
  $("previewCanvas").width = Math.round(sizes[0] * scale);
  $("previewCanvas").height = Math.round(sizes[1] * scale);
  drawPreview();
});
$("qualitySelect").addEventListener("change", () => $("aspectSelect").dispatchEvent(new Event("change")));

function recorderType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

async function renderMasterFilm() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error("This browser does not support local video recording. Try the latest Chrome.");
  }
  const duration = state.voiceBuffer?.duration || 600;
  const mimeType = recorderType();
  if (!mimeType) throw new Error("WebM export is not supported in this browser.");

  $("renderBtn").disabled = true;
  $("renderProgressWrap").classList.remove("hidden");
  $("outputPanel").classList.add("hidden");
  setProgress("render", 0, "Generating the clean visual master…");

  const canvas = $("previewCanvas");
  const stream = canvas.captureStream(24);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Number($("qualitySelect").value) === 480 ? 1600000 : 3500000
  });
  const chunks = [];
  let animationId;
  let stopTimer;
  const started = performance.now();

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => {
      cancelAnimationFrame(animationId);
      if (stopTimer) clearTimeout(stopTimer);
      stream.getTracks().forEach(track => track.stop());
      reject(new Error("The browser stopped the master-video recording unexpectedly."));
    };
    recorder.onstop = () => {
      cancelAnimationFrame(animationId);
      if (stopTimer) clearTimeout(stopTimer);
      stream.getTracks().forEach(track => track.stop());
      state.masterVideoBlob = new Blob(chunks, { type: mimeType });
      if (state.masterVideoUrl) URL.revokeObjectURL(state.masterVideoUrl);
      state.masterVideoUrl = URL.createObjectURL(state.masterVideoBlob);
      state.masterDuration = duration;
      state.masterVideoElement = null;
      $("renderProgressWrap").classList.add("hidden");
      $("outputPanel").classList.remove("hidden");
      $("postVoiceoverToggle").checked = Boolean(state.voiceBuffer);
      $("postMusicToggle").checked = Boolean(state.musicBuffer);
      $("captionsToggle").checked = true;
      updatePostTrackAvailability();
      $("renderBtn").disabled = false;
      $("postEditHint").textContent = "Visual master is ready. Choose your tracks and apply edits below.";
      drawPreview();
      resolve();
    };

    const renderTick = () => {
      const t = Math.min(duration, (performance.now() - started) / 1000);
      drawFrame(t, duration, false, { includeCaptions: false });
      setProgress("render", (t / duration) * 100, "Creating the visual master…");
      if (t < duration) animationId = requestAnimationFrame(renderTick);
      else if (recorder.state !== "inactive") recorder.stop();
    };

    recorder.start(1000);
    renderTick();
    stopTimer = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, duration * 1000 + 500);
  });
}

async function renderFinalVideo() {
  if (!state.masterVideoUrl) throw new Error("Generate the visual film before applying track edits.");
  const includeVoice = $("postVoiceoverToggle").checked && Boolean(state.voiceBuffer);
  const includeMusic = $("postMusicToggle").checked && Boolean(state.musicBuffer);
  const includeCaptions = $("captionsToggle").checked;

  if (includeCaptions && includeVoice && !state.captionWords.length) {
    try {
      await syncCaptions();
    } catch {
      toast("Word sync failed; using scene captions instead.", "info");
    }
  }

  const mimeType = recorderType();
  if (!mimeType) throw new Error("WebM export is not supported in this browser.");
  $("applyPostEditsBtn").disabled = true;
  $("applyPostEditsBtn").textContent = "Applying edits…";
  $("renderProgressWrap").classList.remove("hidden");
  setProgress("render", 0, "Preparing your final mix…");

  const video = document.createElement("video");
  video.src = state.masterVideoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise((resolve, reject) => {
    if (video.readyState >= 1) return resolve();
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("Could not open the visual master for editing."));
  });
  const duration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : state.masterDuration;
  if (video.currentTime !== 0) video.currentTime = 0;

  const canvas = $("previewCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const visualStream = canvas.captureStream(24);
  let audioContext = null;
  let audioDestination = null;
  let voiceSource = null;
  let musicSource = null;
  let combined = visualStream;
  let animationId;
  let stopTimer;
  let started = performance.now();
  let startAt = 0;

  try {
    if (includeVoice || includeMusic) {
      audioContext = new AudioContext();
      await audioContext.resume();
      audioDestination = audioContext.createMediaStreamDestination();
      if (includeVoice) {
        voiceSource = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        gain.gain.value = 1;
        voiceSource.buffer = state.voiceBuffer;
        voiceSource.connect(gain).connect(audioDestination);
      }
      if (includeMusic) {
        musicSource = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        gain.gain.value = .16;
        musicSource.buffer = state.musicBuffer;
        musicSource.loop = true;
        musicSource.connect(gain).connect(audioDestination);
      }
      combined = new MediaStream([
        ...visualStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);
      startAt = audioContext.currentTime + .12;
    }

    const recorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: Number($("qualitySelect").value) === 480 ? 1600000 : 3500000,
      audioBitsPerSecond: 128000
    });
    const chunks = [];

    const paintSubtitles = (time) => {
      if (!includeCaptions) return;
      const block = includeVoice && state.captionBlocks.length ? findCaptionBlock(time) : null;
      if (block) {
        drawKaraokeCaption(ctx, block, time, W, H);
        return;
      }
      const scenes = splitScenes($("scriptInput").value);
      const idx = Math.min(Math.max(0, scenes.length - 1), Math.floor((time / Math.max(1, duration)) * Math.max(1, scenes.length)));
      const line = scenes[idx] || "";
      if (!line) return;
      const lines = wrapText(ctx, line, W * .82).slice(0, 2);
      const fontSize = Math.max(18, W * .026);
      const lineH = fontSize * 1.35;
      const boxH = lines.length * lineH + fontSize * .8;
      const y = H * .82 - boxH / 2;
      ctx.fillStyle = "rgba(8,10,15,.76)";
      ctx.beginPath();
      ctx.roundRect(W * .06, y, W * .88, boxH, 14);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 " + fontSize + "px Arial, sans-serif";
      ctx.textAlign = "center";
      lines.forEach((lineText, i) => ctx.fillText(lineText, W / 2, y + fontSize * .7 + (i + 1) * lineH * .72));
    };

    const finish = () => {
      if (recorder.state !== "inactive") recorder.stop();
    };
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => finish();
    recorder.onstop = async () => {
      cancelAnimationFrame(animationId);
      if (stopTimer) clearTimeout(stopTimer);
      video.pause();
      visualStream.getTracks().forEach(track => track.stop());
      if (combined !== visualStream) combined.getTracks().forEach(track => track.stop());
      if (audioContext && audioContext.state !== "closed") await audioContext.close().catch(() => {});
      const blob = new Blob(chunks, { type: mimeType });
      state.outputBlob = blob;
      if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
      state.outputUrl = URL.createObjectURL(blob);
      $("videoOutput").src = state.outputUrl;
      $("videoDownload").href = state.outputUrl;
      $("videoDownload").download = safeFilename($("videoTitle").value) + ".webm";
      $("videoDownload").textContent = "↓ Download final video";
      $("outputPanel").classList.remove("hidden");
      $("renderProgressWrap").classList.add("hidden");
      $("applyPostEditsBtn").disabled = false;
      $("applyPostEditsBtn").textContent = "Apply edits & export final video";
      $("postEditHint").textContent = "Final video updated. Change any track and apply again without regenerating the visuals.";
      setProgress("render", 100, "Final video ready");
      toast("Final video updated with your selected tracks.", "success");
      drawPreview();
    };

    recorder.start(1000);
    if (voiceSource) voiceSource.start(startAt);
    if (musicSource) musicSource.start(startAt);
    await video.play();

    const renderTick = () => {
      const t = Math.min(duration, video.currentTime || 0);
      ctx.clearRect(0, 0, W, H);
      if (video.readyState >= 2) ctx.drawImage(video, 0, 0, W, H);
      paintSubtitles(t);
      setProgress("render", (t / duration) * 100, "Applying voice, music and subtitles…");
      if (!video.ended && t < duration) animationId = requestAnimationFrame(renderTick);
      else finish();
    };
    renderTick();
    stopTimer = setTimeout(finish, duration * 1000 + 2500);
  } catch (error) {
    cancelAnimationFrame(animationId);
    if (stopTimer) clearTimeout(stopTimer);
    video.pause();
    visualStream.getTracks().forEach(track => track.stop());
    if (combined !== visualStream) combined.getTracks().forEach(track => track.stop());
    if (audioContext && audioContext.state !== "closed") await audioContext.close().catch(() => {});
    $("renderProgressWrap").classList.add("hidden");
    $("applyPostEditsBtn").disabled = false;
    $("applyPostEditsBtn").textContent = "Apply edits & export final video";
    throw error;
  }
}

$("renderBtn").addEventListener("click", async () => {
  try {
    await renderMasterFilm();
    await renderFinalVideo();
  } catch (error) {
    $("renderBtn").disabled = false;
    $("renderProgressWrap").classList.add("hidden");
    toast(error.message || "Video generation failed.", "error");
  }
});

function normalizeEngineUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Paste your ChangJi engine address first.");
  const url = new URL(raw.includes("://") ? raw : "https://" + raw);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Use an HTTP or HTTPS engine address.");
  if (url.username || url.password) throw new Error("Do not put credentials inside the engine URL.");
  return url.origin;
}

function loadEngineUrl() {
  try { return localStorage.getItem("sceneforge.changji.url") || ""; } catch { return ""; }
}

function saveEngineUrl() {
  try {
    const url = normalizeEngineUrl($("filmEngineUrl").value);
    $("filmEngineUrl").value = url;
    localStorage.setItem("sceneforge.changji.url", url);
    $("engineStatus").textContent = "Engine address saved on this device. Open it to check that ChangJi is running.";
    $("engineStatus").classList.add("saved");
    toast("GPU engine address saved on this device.", "success");
    return url;
  } catch (error) {
    toast(error.message, "error");
    return "";
  }
}

function exportFilmBrief() {
  const script = $("scriptInput").value.trim();
  if (!script) return toast("Add a script before exporting the film brief.", "error");
  const scenes = splitScenes(script);
  const brief = {
    format: "sceneforge-film-brief",
    version: 1,
    createdAt: new Date().toISOString(),
    title: $("videoTitle").value.trim() || "Untitled film",
    language: $("captionLanguage").value || "auto",
    aspectRatio: $("aspectSelect").value,
    subtitleStyle: $("captionsToggle").checked ? "word-synced-karaoke-white-yellow" : "off",
    audioSettings: {
      editableAfterGeneration: true,
      voiceover: "choose-on-or-off-after-visual-generation",
      backgroundMusic: "choose-on-or-off-or-replace-after-visual-generation",
      subtitles: "choose-on-or-off-and-resync-after-visual-generation"
    },
    targetDurationMinutes: 10,
    productionIntent: "Generate a complete film targeting ten minutes. Preserve character, wardrobe and location continuity across shots.",
    narrationScript: script,
    sceneDraft: scenes.map((text, index) => ({
      scene: index + 1,
      narration: text,
      visualPrompt: "Create a cinematic visual for this narration. Maintain continuity with recurring characters, locations, props and lighting established in earlier scenes."
    })),
    notes: [
      "SceneForge project brief only; not a rendered video.",
      "Use the connected ChangJi/GPU film engine to write chapters, plan shots, generate first frames and video clips, synthesize dialogue, then assemble the final film.",
      "Check every model checkpoint's own license before commercial use."
    ]
  };
  const blob = new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFilename(brief.title) + "-film-brief.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast("Full-film project brief exported. No upload was made.", "success");
}

$("filmEngineUrl").value = loadEngineUrl();
if ($("filmEngineUrl").value) {
  $("engineStatus").textContent = "Saved engine address found. Open it to confirm the GPU engine is online.";
  $("engineStatus").classList.add("saved");
}
$("saveEngineBtn").addEventListener("click", saveEngineUrl);
$("openEngineBtn").addEventListener("click", () => {
  const url = saveEngineUrl();
  if (!url) return;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) toast("Popup blocked. Copy the saved engine address and open it in a new tab.", "error");
});
$("filmBriefBtn").addEventListener("click", exportFilmBrief);

function safeFilename(name) {
  return (name || "sceneforge-video").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "sceneforge-video";
}

$("mp4Btn").addEventListener("click", async () => {
  if (!state.outputBlob) return;
  const button = $("mp4Btn");
  button.disabled = true;
  button.textContent = "Loading converter…";
  $("mp4Hint").textContent = "Downloading the FFmpeg engine and converting locally. This can take a while on phones.";
  try {
    if (!state.ffmpeg) {
      state.ffmpeg = new FFmpeg();
      state.ffmpeg.on("progress", ({ progress }) => {
        $("mp4Hint").textContent = "MP4 conversion: " + Math.round(progress * 100) + "%";
      });
    }
    if (!state.ffmpegReady) {
      const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
      await state.ffmpeg.load({
        coreURL: await toBlobURL(base + "/ffmpeg-core.js", "text/javascript"),
        wasmURL: await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm")
      });
      state.ffmpegReady = true;
    }
    button.textContent = "Converting…";
    await state.ffmpeg.writeFile("scene.webm", new Uint8Array(await state.outputBlob.arrayBuffer()));
    await state.ffmpeg.exec([
      "-i", "scene.webm", "-c:v", "libx264", "-preset", "ultrafast",
      "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "scene.mp4"
    ]);
    const result = await state.ffmpeg.readFile("scene.mp4");
    const mp4 = new Blob([result.buffer], { type: "video/mp4" });
    const url = URL.createObjectURL(mp4);
    $("videoOutput").src = url;
    $("videoDownload").href = url;
    $("videoDownload").download = safeFilename($("videoTitle").value) + ".mp4";
    $("videoDownload").textContent = "↓ Download MP4";
    $("mp4Hint").textContent = "MP4 ready. Conversion happened locally in this browser.";
    toast("MP4 conversion complete.", "success");
  } catch (error) {
    $("mp4Hint").textContent = "MP4 conversion was not available on this device. Your WebM video is still ready.";
    toast("MP4 conversion failed. Download the WebM version instead.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Convert to MP4";
  }
});

$("clearScript").addEventListener("click", () => {
  $("scriptInput").value = "";
  updateCounts();
});
$("resetBtn").addEventListener("click", () => {
  $("scriptInput").value = sampleScript;
  $("videoTitle").value = "आख़िरी ट्रेन — प्लेटफ़ॉर्म नंबर 0";
  state.voiceBlob = null;
  state.voiceBuffer = null;
  state.masterVideoBlob = null;
  state.masterDuration = 0;
  state.masterVideoElement = null;
  if (state.masterVideoUrl) URL.revokeObjectURL(state.masterVideoUrl);
  state.masterVideoUrl = null;
  $("postVoiceoverToggle").checked = false;
  $("postMusicToggle").checked = false;
  $("captionsToggle").checked = true;
  state.captionWords = [];
  state.captionBlocks = [];
  state.musicBuffer = null;
  state.images = [];
  $("voiceResult").classList.add("hidden");
  $("imageList").innerHTML = "";
  $("musicName").classList.add("hidden");
  $("outputPanel").classList.add("hidden");
  state.outputBlob = null;
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  state.outputUrl = null;
  updateRenderAvailability();
  updateCounts();
  toast("Sample project restored.");
});

updateCounts();
updateRenderAvailability();
