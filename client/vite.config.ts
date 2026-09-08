import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail instead of drifting to 5174: a second dev server on another port
    // looks fine but leaves the first one — and its stale API — in charge.
    strictPort: true,
    // Proxying keeps the API same-origin in development, so the browser never
    // preflights and the RPC client can use a relative base URL everywhere.
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
