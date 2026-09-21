import type { SevenStudiosApi } from '@sevenstudios/ipc';

declare global {
  interface Window {
    sevenstudios?: SevenStudiosApi;
  }
}

export {};
