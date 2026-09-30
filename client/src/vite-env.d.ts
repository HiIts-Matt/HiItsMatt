/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin the API is served from. Defaults to the current origin, which the
   *  dev server proxies to the Hono process. */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The site's version from the root package.json, substituted by Vite's `define`. */
declare const __APP_VERSION__: string;
