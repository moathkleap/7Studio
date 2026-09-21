import type { ApiHandlers } from '@sevenvid/ipc';
import type { EngineServices } from './createEngine';

export type ProviderChannel = 'providers.list' | 'providers.get' | 'providers.setConfig' | 'providers.test';

/** Phase 6 handlers: external AI provider registry (list, configure, test). */
export function createProviderHandlers(s: EngineServices): Pick<ApiHandlers, ProviderChannel> {
  return {
    'providers.list': () => s.providers.list(),
    'providers.get': ({ providerId }) => s.providers.status(providerId),
    'providers.setConfig': ({ providerId, enabled, baseUrl, model, secret }) => s.providers.setConfig(providerId, { enabled, baseUrl, model, secret }),
    'providers.test': ({ providerId }) => s.providers.test(providerId),
  };
}
