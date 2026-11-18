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
- Video render duration is limited to 10 minutes for phone stability.

## Deployment

The app is a Vite static site and can be deployed to Vercel with the project root set to `video-studio`.
