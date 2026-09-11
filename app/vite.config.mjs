import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
    rollupOptions: { input: { main: "index.html", watch: "watch.html" } },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    port: 4317,
    proxy: {
      "/api": "http://127.0.0.1:4318",
      "/media": "http://127.0.0.1:4318",
      "/downloads": "http://127.0.0.1:4318",
    },
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
