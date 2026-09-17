import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { isChannel, type ChannelName } from '@sevenvid/ipc';
import { AppError } from '../errors';
import type { Engine } from '../api/createEngine';

export interface DevBridgeOptions {
  port: number;
  host?: string;
  token: string;
}

export interface DevBridge {
  port: number;
  url: string;
  close(): Promise<void>;
}

type ClientMessage = { t: 'invoke'; id: string; channel: string; input?: unknown } | { t: 'ping' };

/**
 * Exposes the exact IPC contract over a local WebSocket so the renderer can run in a plain browser
 * (development and end-to-end tests). Requires a per-run token; binds to loopback only.
 */
export async function startDevBridge(engine: Engine, opts: DevBridgeOptions): Promise<DevBridge> {
  const host = opts.host ?? '127.0.0.1';
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/health')) {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, mode: 'browser', at: new Date().toISOString() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.searchParams.get('token') !== opts.token) {
      ws.close(4401, 'unauthorized');
      return;
    }
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      if (msg.t === 'ping') {
        ws.send(JSON.stringify({ t: 'pong' }));
        return;
      }
      if (msg.t !== 'invoke') return;
      if (!isChannel(msg.channel)) {
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: false, error: new AppError({ code: 'INVALID_INPUT', operation: msg.channel, message: `Unknown channel ${msg.channel}` }).info }));
        return;
      }
      try {
        const data = await engine.invoke(msg.channel as ChannelName, msg.input as never);
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: true, data: data ?? null }));
      } catch (err) {
        const info = AppError.from(err, { code: 'UNKNOWN', operation: msg.channel }).info;
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: false, error: info }));
      }
    });
  });

  const unsubscribe = engine.bus.onAny((event, payload) => {
    const frame = JSON.stringify({ t: 'event', event, payload });
    for (const c of clients) if (c.readyState === c.OPEN) c.send(frame);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  engine.logger.info({ module: 'devbridge', port }, 'dev bridge listening');
  return {
    port,
    url: `ws://${host}:${port}/?token=${opts.token}`,
    async close() {
      unsubscribe();
      for (const c of clients) c.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
