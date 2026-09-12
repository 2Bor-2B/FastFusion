/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" to use the in-browser mock instead of the FastAPI backend. */
  readonly VITE_USE_MOCK?: string;
  /** Backend origin; empty/undefined means same origin. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
