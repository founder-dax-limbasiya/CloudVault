# SceneForge Studio

A phone-friendly, local-first script-to-video studio. Designed for story creators who want to generate a Hindi narration track and turn it into a cinematic captioned video without uploading private media to a server.

## What it does

- Hindi neural text-to-speech using Piper / VITS in a browser worker.
- The Hindi Rohan voice model is downloaded once and cached by the browser (about 63 MB).
- User-uploaded photos become animated cinematic scenes; without photos, the editor generates abstract motion/typographic scenes from the script.
- Optional voiceover upload and background music.
- Narration/music mixing and video rendering with Canvas + MediaRecorder.
- WebM export, plus optional MP4 conversion through FFmpeg.wasm.
- 16:9, 9:16 and 1:1 layouts; 480p/720p output.
- Local browser processing. No account, application backend, or storage service.

## Run

```bash
npm install
npm run dev
```

## Open-source components

- [Piper TTS](https://github.com/rhasspy/piper) — Apache-2.0 runtime; individual voice model terms must be checked separately.
- [Piper TTS Web fork](https://github.com/PBJI/piper-tts-web) — MIT.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) — MIT.
- [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) — wrapper is MIT; FFmpeg core carries its own FFmpeg/library licensing.
- [Vite](https://github.com/vitejs/vite) — MIT.

## Hindi voice model notice

The configured Rohan Hindi ONNX weights are fetched from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/main/hi/hi_IN/rohan/medium). The repository is labelled MIT, while the model card points to the IITM IndicTTS dataset and its separate license. Check that dataset/voice terms before using generated speech commercially or distributing the weights. No model files are bundled in this repository.

## Limitations

- This is a local scene compositor, not a diffusion text-to-video generator. It animates uploaded photos or creates graphic/text-based scenes.
- The first TTS model download needs an internet connection and device storage.
- MP4 conversion is heavier than WebM and can fail on low-memory phones; WebM remains available as a fallback.
- Browser rendering is constrained by device memory, storage and battery. For reliable long-form films, a persistent queued GPU render worker is required.

## Deployment

The app is a Vite static site and can be deployed to Vercel with the project root set to `video-studio`.


## Open-source caption and long-form upgrades

- **Word-aligned captions:** local multilingual Whisper through Transformers.js, returning word-level timestamps in the browser. The karaoke grouping/highlight treatment is adapted from OpenShorts' MIT-licensed subtitle workflow (white words, yellow active word, pop emphasis, short timed blocks).
- **Long scripts:** scene splitting no longer truncates at 28 scenes; Piper narration is synthesized in smaller passages and stitched into one WAV. Mobile memory and processing speed still depend on the device.
- **No fixed 10-minute export stop:** the old hard stop has been removed. Very long canvas recordings can still run out of mobile memory; a queued cloud render worker is the proper route for long films.
- **Film-pipeline research:** ChangJi is an Apache-2.0 open-source AI film-studio reference for chapter/shot tables, continuity assets, render retries, and final film joining. It runs its AI models on a GPU machine; it is not a Vercel function and its model weights have separate terms.
- **Video model research:** Wan 2.2, HunyuanVideo 1.5, and LTX-2.3 are candidate GPU backends. We must review each checkpoint's model license before commercial use; Vercel hosts the UI/orchestration, not these GPU weights.

### Source projects
- OpenShorts: https://github.com/agusmakmun/openshorts (MIT core; subtitle timing and karaoke styling reference)
- Hugging Face Transformers.js: https://github.com/huggingface/transformers.js
- Whisper ONNX multilingual tiny: https://huggingface.co/onnx-community/whisper-tiny
- ChangJi: https://github.com/changji-ai/ChangJi (Apache-2.0 application; downloaded model weights have separate licenses)
- AI video model survey: https://github.com/backblaze-labs/awesome-video-generation


## Mobile and hosted-rendering notes

- Browser ASR is configured to use ONNX Runtime Web (WASM/WebGPU). The Vercel build skips the optional Node CUDA execution-provider download; CUDA is not needed to run inference in the browser.
- Long-form rendering from a mobile browser can still be interrupted by memory pressure or the browser suspending the tab. Removing a software duration cap does not make phone memory unlimited.
