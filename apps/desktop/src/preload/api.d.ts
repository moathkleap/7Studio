import type { SevenvidApi } from '@sevenstudios/ipc';

declare global {
  interface Window {
    sevenvid?: SevenvidApi;
  }
}

export {};
