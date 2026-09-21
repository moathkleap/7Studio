import type { SevenstudiosApi } from '@sevenstudios/ipc';

declare global {
  interface Window {
    sevenstudios?: SevenstudiosApi;
  }
}

export {};
