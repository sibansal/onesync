/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_MS_CLIENT_ID?: string;
  readonly MAIN_VITE_MS_AUTHORITY?: string;
  readonly MAIN_VITE_GRAPH_BASE_URL?: string;
  readonly MAIN_VITE_SYNC_CONCURRENCY?: string;
  readonly MAIN_VITE_MAX_RETRIES?: string;
  readonly MAIN_VITE_RETRY_BASE_DELAY_MS?: string;
  readonly MAIN_VITE_MASS_MOVE_THRESHOLD?: string;
  readonly MAIN_VITE_USE_MOCK_DRIVE?: string;
  readonly MAIN_VITE_ALLOW_INTERNAL_DESTINATION?: string;
  readonly MAIN_VITE_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
