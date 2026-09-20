import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';

let dir: string;
let engine: Engine;
let server: http.Server;
let port = 0;
let lastAuth: string | null = null;

beforeEach(async () => {
  // a local OpenAI-compatible mock: echoes each user line prefixed with "T:" (preserving line count)
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      lastAuth = req.headers.authorization ?? null;
      if (!req.url?.includes('/chat/completions')) {
        res.writeHead(404).end('{}');
        return;
      }
      const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> };
      const user = parsed.messages.find((m) => m.role === 'user')?.content ?? '';
      const content = user.includes('single word: ok') ? 'ok' : user.split('\n').map((l) => `T:${l}`).join('\n');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  dir = tempDir();
  engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
  await engine.start();
});

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function enableMockProvider() {
  await engine.invoke('settings.update', { patch: { privacy: { allowExternalProviders: true } } });
  return engine.invoke('providers.setConfig', { providerId: 'openai-compatible', enabled: true, baseUrl: `http://127.0.0.1:${port}`, model: 'mock', secret: 'sk-test-123' });
}

describe('providers service', () => {
  it('lists the built-in providers and reports them as needing configuration by default', async () => {
    const list = await engine.invoke('providers.list');
    expect(list.map((p) => p.id).sort()).toEqual(['anthropic', 'ollama', 'openai-compatible']);
    expect(list.every((p) => !p.configured)).toBe(true);
    // llm.text / translate are gated on a configured provider
    expect(engine.capabilities.status('llm.text').status).toBe('needs-provider');
    expect(engine.capabilities.status('translate').status).toBe('needs-provider');
  });

  it('configures a provider, makes llm.text available, and never returns the raw secret', async () => {
    const status = await enableMockProvider();
    expect(status.enabled).toBe(true);
    expect(status.configured).toBe(true);
    expect(status.hasSecret).toBe(true);
    // the raw secret is not part of the status payload
    expect(JSON.stringify(status)).not.toContain('sk-test-123');
    expect(engine.capabilities.status('llm.text').status).toBe('available');
    expect(engine.capabilities.status('translate').status).toBe('available');
  });

  it('runs a real round-trip through the gateway with the configured credentials and logs it', async () => {
    await enableMockProvider();
    const test = await engine.invoke('providers.test', { providerId: 'openai-compatible' });
    expect(test.ok, test.message).toBe(true);
    expect(test.message).toBe('ok');
    expect(lastAuth).toBe('Bearer sk-test-123');
    const r = await engine.providers.translate('one\ntwo\nthree', 'en');
    // the mock prefixes each user line with "T:", proving the request body reached it through the gateway
    expect(r.text).toContain('T:one');
    expect(r.text).toContain('T:three');
    expect(r.providerId).toBe('openai-compatible');
    const log = engine.db.networkLog.recent(20);
    expect(log.some((e) => e.providerId === 'openai-compatible' && e.status === 'ok')).toBe(true);
  });

  it('refuses to call out when external providers are disabled in Privacy settings', async () => {
    await enableMockProvider();
    await engine.invoke('settings.update', { patch: { privacy: { allowExternalProviders: false } } });
    await expect(engine.providers.complete({ system: 's', prompt: 'hi' })).rejects.toMatchObject({ info: { code: 'NETWORK_BLOCKED' } });
    // and the capability reflects that a call would be blocked is still "available" (configured) — the block is honest at call time
    const test = await engine.invoke('providers.test', { providerId: 'openai-compatible' });
    expect(test.ok).toBe(false);
    expect(test.message.toLowerCase()).toContain('block');
  });

  it('clearing the secret makes the provider unconfigured again', async () => {
    await enableMockProvider();
    const cleared = await engine.invoke('providers.setConfig', { providerId: 'openai-compatible', secret: '' });
    expect(cleared.hasSecret).toBe(false);
    expect(cleared.configured).toBe(false);
    expect(engine.capabilities.status('llm.text').status).toBe('needs-provider');
  });
});
