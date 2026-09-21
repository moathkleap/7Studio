import { contextBridge, ipcRenderer } from 'electron';
import type { AppErrorInfo } from '@sevenstudios/core';
import type { ChannelName, EventName, IpcResponse, SevenStudiosApi } from '@sevenstudios/ipc';

class RemoteError extends Error {
  constructor(readonly info: AppErrorInfo) {
    super(info.message);
    this.name = 'AppError';
  }
}

const api: SevenStudiosApi = {
  mode: 'electron',
  async invoke(channel: ChannelName, input?: unknown) {
    const res = (await ipcRenderer.invoke('sevenstudios:api', channel, input ?? null)) as IpcResponse<unknown>;
    if (res.ok) return res.data as never;
    throw new RemoteError(res.error);
  },
  subscribe(event: EventName, handler) {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => handler(payload as never);
    ipcRenderer.on(`sevenstudios:event:${event}`, listener);
    return () => ipcRenderer.removeListener(`sevenstudios:event:${event}`, listener);
  },
};

contextBridge.exposeInMainWorld('sevenstudios', api);
