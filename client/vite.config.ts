import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser only ever talks to the Vite dev server. Calls to /api are proxied
// to the FastAPI backend, so there is no cross-origin request and no CORS to set up.
// API_URL points the proxy at another backend, e.g. a second API on another port.
const api = process.env.API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: api,
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      "/api": {
        target: api,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
