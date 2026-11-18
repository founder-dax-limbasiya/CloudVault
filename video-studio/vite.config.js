import { defineConfig } from "vite";

export default defineConfig({
  worker: {
    format: "es"
  },
  build: {
    target: "es2022",
    sourcemap: false
  },
  optimizeDeps: {
    exclude: ["@pbji/piper-tts-web", "onnxruntime-web"]
  }
});