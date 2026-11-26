import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, Vite forwards /api to the API so the browser sees one origin
// (no CORS). In Docker, nginx does the same job (see nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
});
