/// <reference types="vite/client" />
import type { OneSyncAPI } from '../../shared/types';

declare global {
  interface Window {
    onesync: OneSyncAPI;
  }
}
