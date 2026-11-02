import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `--mode mock` loads .env.mock (VITE_MOCK=1): the whole API is served in-browser from src/api/mock.ts.
export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8765", changeOrigin: false } },
  },
  preview: { port: 5173, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:8765" } } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          r3f: ["@react-three/fiber", "@react-three/drei", "@react-three/postprocessing", "postprocessing"],
          ui: ["react", "react-dom", "react-router-dom", "framer-motion", "@tanstack/react-query", "zustand"],
        },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
