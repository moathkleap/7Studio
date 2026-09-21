import type { SevenstudiosApi } from '@sevenstudios/ipc';
import { WsClient } from './wsClient';

let client: SevenstudiosApi | null = null;
let ws: WsClient | null = null;

/** Returns the API: the Electron preload bridge when present, otherwise the browser-mode WebSocket client. */
export function getApi(): SevenstudiosApi {
  if (client) return client;
  if (typeof window !== 'undefined' && window.sevenstudios) {
    client = window.sevenstudios;
    return client;
  }
  const params = new URLSearchParams(window.location.search);
  const fromEnv = (import.meta.env.VITE_DEVBRIDGE_URL as string | undefined) || undefined;
  const url = params.get('bridge') ?? fromEnv ?? 'ws://127.0.0.1:7777/?token=dev';
  ws = new WsClient(url);
  client = ws;
  return client;
}

export function getBridge(): WsClient | null {
  getApi();
  return ws;
}

export { RemoteError } from './wsClient';
