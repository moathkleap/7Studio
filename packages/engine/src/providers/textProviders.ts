import { AppError } from '../errors';
import type { NetworkGateway } from '../network/NetworkGateway';
import type { ProviderDescriptor } from './descriptors';

export interface ResolvedProviderConfig {
  baseUrl: string;
  model: string;
  secret: string;
}

export interface CompleteRequest {
  system: string;
  prompt: string;
  wantJson?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Calls a text provider through the NetworkGateway and returns the assistant's text.
 * Anthropic, OpenAI-compatible and Ollama shapes are supported; every request is gated and logged.
 */
export async function completeText(descriptor: ProviderDescriptor, config: ResolvedProviderConfig, gateway: NetworkGateway, req: CompleteRequest): Promise<string> {
  const purpose = `provider:${descriptor.id}`;
  const base = trimBase(config.baseUrl || descriptor.defaultBaseUrl);
  const model = config.model || descriptor.defaultModel;
  const maxTokens = req.maxTokens ?? 1024;

  if (descriptor.id === 'anthropic') {
    const { json } = await gateway.fetchJson<{ content?: Array<{ text?: string }> }>(`${base}/v1/messages`, {
      purpose,
      providerId: descriptor.id,
      headers: { 'x-api-key': config.secret, 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: maxTokens, system: req.system, messages: [{ role: 'user', content: req.prompt }] },
      signal: req.signal,
    });
    const text = json.content?.map((c) => c.text ?? '').join('') ?? '';
    if (!text) throw new AppError({ code: 'PROVIDER_FAILED', operation: 'provider.complete', message: 'Empty response from Anthropic' });
    return text;
  }

  if (descriptor.id === 'openai-compatible') {
    const { json } = await gateway.fetchJson<{ choices?: Array<{ message?: { content?: string } }> }>(`${base}/chat/completions`, {
      purpose,
      providerId: descriptor.id,
      headers: { authorization: `Bearer ${config.secret}` },
      body: { model, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.prompt }], ...(req.wantJson ? { response_format: { type: 'json_object' } } : {}) },
      signal: req.signal,
    });
    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text) throw new AppError({ code: 'PROVIDER_FAILED', operation: 'provider.complete', message: 'Empty response from provider' });
    return text;
  }

  // ollama
  const { json } = await gateway.fetchJson<{ message?: { content?: string } }>(`${base}/api/chat`, {
    purpose,
    providerId: descriptor.id,
    body: { model, stream: false, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.prompt }], ...(req.wantJson ? { format: 'json' } : {}) },
    signal: req.signal,
    timeoutMs: 120_000,
  });
  const text = json.message?.content ?? '';
  if (!text) throw new AppError({ code: 'PROVIDER_FAILED', operation: 'provider.complete', message: 'Empty response from Ollama' });
  return text;
}

/** Extracts the first JSON value from a model reply (handles code fences and surrounding prose). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new AppError({ code: 'PROVIDER_FAILED', operation: 'provider.json', message: 'No JSON found in the model reply' });
  const open = candidate[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch (err) {
          throw AppError.from(err, { code: 'PROVIDER_FAILED', operation: 'provider.json', message: 'The model reply was not valid JSON' });
        }
      }
    }
  }
  throw new AppError({ code: 'PROVIDER_FAILED', operation: 'provider.json', message: 'Unterminated JSON in the model reply' });
}
