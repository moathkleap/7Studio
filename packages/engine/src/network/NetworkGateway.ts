import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import type { AppDatabase } from '../db/database';
import { AppError } from '../errors';
import type { Logger } from '../logging/logger';
import type { SettingsService } from '../settings/SettingsService';

export interface FetchOptions {
  /** Why this request happens (shown in the network log), e.g. `model:silero/vad-v5`. */
  purpose: string;
  providerId: string | null;
  toFile: string;
  onProgress?: (bytes: number, total: number | null) => void;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * The only path to the network. Every request is checked against the privacy settings, logged with host,
 * purpose and byte counts, and never made unless the user enabled the relevant feature.
 */
export class NetworkGateway {
  constructor(
    private readonly db: AppDatabase,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
  ) {}

  /** Returns null when allowed, or the blocking reason. */
  policyFor(purpose: string): string | null {
    const p = this.settings.get().privacy;
    if (purpose.startsWith('model:')) return p.allowModelDownloads ? null : 'model downloads are disabled in Privacy settings';
    if (purpose.startsWith('provider:')) return p.allowExternalProviders ? null : 'external providers are disabled in Privacy settings';
    if (purpose.startsWith('trends:')) return p.allowTrends ? null : 'trend sync is disabled in Privacy settings';
    return 'unknown purpose';
  }

  private log(entry: { providerId: string | null; host: string; purpose: string; bytesOut: number; bytesIn: number; status: string }): void {
    if (!this.settings.get().privacy.networkLogging) return;
    try {
      this.db.networkLog.add(entry);
    } catch (err) {
      this.logger.warn({ module: 'network', err }, 'network log write failed');
    }
  }

  /** Makes a gated JSON request (used by cloud/local AI providers). HTTPS only, except localhost for local services. */
  fetchJson = async <T = unknown>(url: string, opts: { purpose: string; providerId: string | null; method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number }): Promise<{ status: number; json: T }> => {
    const blocked = this.policyFor(opts.purpose);
    const host = safeHost(url);
    if (blocked) {
      this.log({ providerId: opts.providerId, host, purpose: opts.purpose, bytesOut: 0, bytesIn: 0, status: 'blocked' });
      throw new AppError({ code: 'NETWORK_BLOCKED', operation: 'network.json', message: `Request to ${host} blocked: ${blocked}`, details: { url, purpose: opts.purpose } });
    }
    const bodyStr = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    try {
      const res = await requestJson(url, { method: opts.method ?? 'POST', body: bodyStr, headers: opts.headers ?? {}, signal: opts.signal, timeoutMs: opts.timeoutMs ?? 60_000 });
      this.log({ providerId: opts.providerId, host, purpose: opts.purpose, bytesOut: bodyStr ? Buffer.byteLength(bodyStr) : 0, bytesIn: res.bytes, status: res.status >= 200 && res.status < 300 ? 'ok' : 'failed' });
      let json: T;
      try {
        json = res.text ? (JSON.parse(res.text) as T) : ({} as T);
      } catch {
        throw new AppError({ code: 'PROVIDER_FAILED', operation: 'network.json', message: `Non-JSON response (HTTP ${res.status}) from ${host}`, details: { status: res.status, body: res.text.slice(0, 300) } });
      }
      if (res.status < 200 || res.status >= 300) {
        throw new AppError({ code: res.status === 401 || res.status === 403 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_FAILED', operation: 'network.json', message: `HTTP ${res.status} from ${host}`, details: { status: res.status, body: res.text.slice(0, 300) } });
      }
      return { status: res.status, json };
    } catch (err) {
      const appErr = AppError.from(err, { code: 'PROVIDER_FAILED', operation: 'network.json', details: { url, purpose: opts.purpose } });
      if (appErr.info.code !== 'NETWORK_BLOCKED') this.log({ providerId: opts.providerId, host, purpose: opts.purpose, bytesOut: bodyStr ? Buffer.byteLength(bodyStr) : 0, bytesIn: 0, status: appErr.info.code === 'TASK_CANCELLED' ? 'cancelled' : 'failed' });
      throw appErr;
    }
  };

  /** Streams a URL to a file with resume support (HTTP Range) and redirect handling. */
  fetchToFile = async (url: string, opts: FetchOptions): Promise<{ bytes: number }> => {
    const blocked = this.policyFor(opts.purpose);
    const host = safeHost(url);
    if (blocked) {
      this.log({ providerId: opts.providerId, host, purpose: opts.purpose, bytesOut: 0, bytesIn: 0, status: 'blocked' });
      throw new AppError({ code: 'NETWORK_BLOCKED', operation: 'network.fetch', message: `Request to ${host} blocked: ${blocked}`, details: { url, purpose: opts.purpose } });
    }
    fs.mkdirSync(path.dirname(opts.toFile), { recursive: true });
    const existing = fs.existsSync(opts.toFile) ? fs.statSync(opts.toFile).size : 0;
    this.logger.info({ module: 'network', operation: 'fetch', host, purpose: opts.purpose, resumeFrom: existing }, 'network request');
    try {
      const result = await download(url, opts, existing, 0);
      this.log({ providerId: opts.providerId, host, purpose: opts.purpose, bytesOut: 0, bytesIn: result.bytes, status: 'ok' });
      return result;
    } catch (err) {
      const appErr = AppError.from(err, { code: 'NETWORK_FAILED', operation: 'network.fetch', details: { url, purpose: opts.purpose } });
      this.log({ providerId: opts.providerId, host, purpose: opts.purpose, bytesOut: 0, bytesIn: 0, status: appErr.info.code === 'TASK_CANCELLED' ? 'cancelled' : 'failed' });
      throw appErr;
    }
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

function download(url: string, opts: FetchOptions, resumeFrom: number, redirects: number): Promise<{ bytes: number }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new AppError({ code: 'INVALID_INPUT', operation: 'network.fetch', message: `Invalid URL ${url}` }));
      return;
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'))) {
      reject(new AppError({ code: 'NETWORK_BLOCKED', operation: 'network.fetch', message: `Only HTTPS downloads are allowed (${parsed.protocol})` }));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = { 'user-agent': 'sevenvid/0.1', ...(opts.headers ?? {}) };
    if (resumeFrom > 0) headers.range = `bytes=${resumeFrom}-`;
    const req = lib.request(parsed, { method: 'GET', headers, timeout: opts.timeoutMs ?? 60_000 }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if (redirects >= 5) return reject(new AppError({ code: 'NETWORK_FAILED', operation: 'network.fetch', message: 'too many redirects' }));
        return resolve(download(new URL(res.headers.location, parsed).toString(), opts, resumeFrom, redirects + 1));
      }
      if (status === 416) {
        res.resume();
        return resolve({ bytes: resumeFrom });
      }
      if (status !== 200 && status !== 206) {
        res.resume();
        return reject(new AppError({ code: 'NETWORK_FAILED', operation: 'network.fetch', message: `HTTP ${status} from ${parsed.host}`, details: { status, url } }));
      }
      const append = status === 206 && resumeFrom > 0;
      const total = res.headers['content-length'] ? Number(res.headers['content-length']) + (append ? resumeFrom : 0) : null;
      let bytes = append ? resumeFrom : 0;
      const out = fs.createWriteStream(opts.toFile, { flags: append ? 'a' : 'w' });
      const onAbort = () => {
        req.destroy(new AppError({ code: 'TASK_CANCELLED', operation: 'network.fetch', message: 'download cancelled' }));
        out.destroy();
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        opts.onProgress?.(bytes, total);
      });
      res.on('error', (err) => {
        out.destroy();
        reject(err);
      });
      out.on('error', reject);
      res.pipe(out);
      out.on('finish', () => {
        opts.signal?.removeEventListener('abort', onAbort);
        if (total != null && bytes !== total) return reject(new AppError({ code: 'NETWORK_FAILED', operation: 'network.fetch', message: `incomplete download (${bytes} of ${total} bytes)`, details: { url } }));
        resolve({ bytes });
      });
    });
    req.on('timeout', () => req.destroy(new AppError({ code: 'NETWORK_FAILED', operation: 'network.fetch', message: `timeout contacting ${parsed.host}` })));
    req.on('error', (err) => reject(err));
    req.end();
  });
}

/** Buffers a JSON HTTP(S) response. HTTPS only, except localhost for local AI services (e.g. Ollama). */
function requestJson(url: string, opts: { method: string; body?: string; headers: Record<string, string>; signal?: AbortSignal; timeoutMs: number }): Promise<{ status: number; text: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new AppError({ code: 'INVALID_INPUT', operation: 'network.json', message: `Invalid URL ${url}` }));
      return;
    }
    const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
      reject(new AppError({ code: 'NETWORK_BLOCKED', operation: 'network.json', message: `Only HTTPS is allowed for providers (${parsed.protocol})` }));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = { 'user-agent': 'sevenvid/0.1', accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      headers['content-length'] = String(Buffer.byteLength(opts.body));
    }
    const req = lib.request(parsed, { method: opts.method, headers, timeout: opts.timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        opts.signal?.removeEventListener('abort', onAbort);
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, text: buf.toString('utf8'), bytes: buf.length });
      });
    });
    const onAbort = () => req.destroy(new AppError({ code: 'TASK_CANCELLED', operation: 'network.json', message: 'cancelled' }));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    req.on('timeout', () => req.destroy(new AppError({ code: 'PROVIDER_FAILED', operation: 'network.json', message: `timeout contacting ${parsed.host}` })));
    req.on('error', (err) => reject(err));
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
