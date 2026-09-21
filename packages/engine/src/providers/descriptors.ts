import type { CapabilityId } from '@sevenvid/core';

export type ProviderKind = 'cloud' | 'local-service';

export interface ProviderDescriptor {
  id: string;
  name: string;
  kind: ProviderKind;
  /** The capabilities this provider can serve. */
  capabilities: CapabilityId[];
  /** True when a request leaves the machine (drives the external-processing badge and consent). */
  external: boolean;
  needsSecret: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Host that must be reachable/allowlisted (for documentation and the network log). */
  host: string;
  docsUrl: string;
}

/** Text-model providers the assistant, translation and Creator script can use when the user enables one. */
export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'cloud',
    capabilities: ['llm.text', 'translate'],
    external: true,
    needsSecret: true,
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-5',
    host: 'api.anthropic.com',
    docsUrl: 'https://docs.anthropic.com',
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    kind: 'cloud',
    capabilities: ['llm.text', 'translate'],
    external: true,
    needsSecret: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    host: 'api.openai.com',
    docsUrl: 'https://platform.openai.com',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'local-service',
    capabilities: ['llm.text', 'translate'],
    external: false,
    needsSecret: false,
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'qwen2.5:7b-instruct',
    host: '127.0.0.1',
    docsUrl: 'https://ollama.com',
  },
];

export function getDescriptor(id: string): ProviderDescriptor | undefined {
  return PROVIDER_DESCRIPTORS.find((d) => d.id === id);
}
