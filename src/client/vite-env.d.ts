/// <reference types="vite/client" />
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}
interface ImportMetaEnv {
  readonly VITE_RELAY_ACCENT?: string;
  readonly VITE_RELAY_BUILD?: string;
}
