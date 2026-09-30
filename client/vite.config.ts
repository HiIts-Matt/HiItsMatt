import { readFileSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The site's version lives in the root package.json, the one `npm version` bumps.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
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
