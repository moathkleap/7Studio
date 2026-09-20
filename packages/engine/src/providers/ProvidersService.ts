import type { z } from 'zod';
import type { CapabilityId } from '@sevenvid/core';
import type { EngineHost } from '../api/host';
import type { CapabilityRegistry, CapabilityReport } from '../capabilities/CapabilityRegistry';
import type { AppDatabase } from '../db/database';
import type { StoredProviderConfig } from '../db/repos/providers';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';
import type { NetworkGateway } from '../network/NetworkGateway';
import type { SettingsService } from '../settings/SettingsService';
import { getDescriptor, PROVIDER_DESCRIPTORS, type ProviderDescriptor } from './descriptors';
import { completeText, extractJson, type CompleteRequest, type ResolvedProviderConfig } from './textProviders';

export interface ProviderStatus {
  id: string;
  name: string;
  kind: ProviderDescriptor['kind'];
  external: boolean;
  needsSecret: boolean;
  enabled: boolean;
  configured: boolean;
  hasSecret: boolean;
  secretEncrypted: boolean;
  baseUrl: string;
  model: string;
  defaultBaseUrl: string;
  defaultModel: string;
  capabilities: CapabilityId[];
  docsUrl: string;
}

const EMPTY: StoredProviderConfig = { baseUrl: '', model: '', secret: '', secretEncrypted: false, extra: {} };

/**
 * External AI provider registry and gateway. Manages enablement and configuration (with OS-backed secret storage
 * when available), reports honest capability availability, and runs text completions/translation through the
 * NetworkGateway. Nothing leaves the machine unless the user enabled external providers in Privacy settings.
 */
export class ProvidersService {
  constructor(
    private readonly db: AppDatabase,
    private readonly settings: SettingsService,
    private readonly gateway: NetworkGateway,
    private readonly host: EngineHost,
    private readonly capabilities: CapabilityRegistry,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    this.registerCapabilities();
  }

  // ------------------------------------------------------------------------------------------------ configuration

  private stored(id: string): StoredProviderConfig {
    return this.db.providers.get(id)?.config ?? { ...EMPTY };
  }

  private isEnabled(id: string): boolean {
    return this.db.providers.get(id)?.enabled ?? false;
  }

  private resolved(descriptor: ProviderDescriptor): ResolvedProviderConfig {
    const c = this.stored(descriptor.id);
    let secret = c.secret;
    if (secret && c.secretEncrypted && this.host.secrets?.available) {
      try {
        secret = this.host.secrets.decrypt(secret);
      } catch (err) {
        this.logger.warn({ module: 'providers', id: descriptor.id, err }, 'secret decrypt failed');
        secret = '';
      }
    }
    return { baseUrl: c.baseUrl || descriptor.defaultBaseUrl, model: c.model || descriptor.defaultModel, secret };
  }

  /** True when a provider has everything it needs to run (enabled, and a secret when one is required). */
  private configured(descriptor: ProviderDescriptor): boolean {
    if (!this.isEnabled(descriptor.id)) return false;
    const c = this.resolved(descriptor);
    if (!c.baseUrl || !c.model) return false;
    if (descriptor.needsSecret && !c.secret) return false;
    return true;
  }

  status(id: string): ProviderStatus {
    const d = getDescriptor(id);
    if (!d) throw new AppError({ code: 'INVALID_INPUT', operation: 'providers.get', message: `Unknown provider ${id}` });
    const c = this.stored(id);
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      external: d.external,
      needsSecret: d.needsSecret,
      enabled: this.isEnabled(id),
      configured: this.configured(d),
      hasSecret: Boolean(c.secret),
      secretEncrypted: c.secretEncrypted,
      baseUrl: c.baseUrl || d.defaultBaseUrl,
      model: c.model || d.defaultModel,
      defaultBaseUrl: d.defaultBaseUrl,
      defaultModel: d.defaultModel,
      capabilities: d.capabilities,
      docsUrl: d.docsUrl,
    };
  }

  list(): ProviderStatus[] {
    return PROVIDER_DESCRIPTORS.map((d) => this.status(d.id));
  }

  /** Updates a provider's config. An omitted `secret` keeps the stored one; an empty string clears it. */
  async setConfig(id: string, patch: { enabled?: boolean; baseUrl?: string; model?: string; secret?: string }): Promise<ProviderStatus> {
    const d = getDescriptor(id);
    if (!d) throw new AppError({ code: 'INVALID_INPUT', operation: 'providers.setConfig', message: `Unknown provider ${id}` });
    const current = this.stored(id);
    const next: StoredProviderConfig = { ...current, baseUrl: patch.baseUrl ?? current.baseUrl, model: patch.model ?? current.model };
    if (patch.secret !== undefined) {
      if (patch.secret === '') {
        next.secret = '';
        next.secretEncrypted = false;
      } else if (this.host.secrets?.available) {
        next.secret = this.host.secrets.encrypt(patch.secret);
        next.secretEncrypted = true;
      } else {
        next.secret = patch.secret;
        next.secretEncrypted = false;
      }
    }
    const enabled = patch.enabled ?? this.isEnabled(id);
    this.db.providers.set(id, enabled, next);
    await this.capabilities.refresh();
    this.bus.emit('providers.changed', { providerId: id });
    this.logger.info({ module: 'providers', operation: 'setConfig', id, enabled, external: d.external }, 'provider configured');
    return this.status(id);
  }

  // -------------------------------------------------------------------------------------------------- completion

  /** Picks the text provider to use: the user's preferred one if configured, otherwise the first configured one. */
  private textProvider(): { descriptor: ProviderDescriptor; config: ResolvedProviderConfig } | null {
    const preferred = this.settings.get().ai.preferredTextProvider;
    const candidates = PROVIDER_DESCRIPTORS.filter((d) => d.capabilities.includes('llm.text') && this.configured(d));
    const chosen = candidates.find((d) => d.id === preferred) ?? candidates[0];
    return chosen ? { descriptor: chosen, config: this.resolved(chosen) } : null;
  }

  hasTextProvider(): boolean {
    return this.textProvider() !== null;
  }

  async complete(req: CompleteRequest): Promise<{ text: string; providerId: string }> {
    const chosen = this.textProvider();
    if (!chosen) throw new AppError({ code: 'PROVIDER_UNAVAILABLE', operation: 'providers.complete', message: 'No text provider is enabled and configured', recovery: [] });
    const text = await completeText(chosen.descriptor, chosen.config, this.gateway, req);
    return { text, providerId: chosen.descriptor.id };
  }

  /** Completes and parses a JSON reply against a schema (used by the planner and the Creator script writer). */
  async completeJson<T>(system: string, prompt: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<{ value: T; providerId: string }> {
    const { text, providerId } = await this.complete({ system, prompt, wantJson: true, signal });
    const parsed = schema.safeParse(extractJson(text));
    if (!parsed.success) throw new AppError({ code: 'PROVIDER_FAILED', operation: 'providers.completeJson', message: 'The model reply did not match the expected schema', details: { issues: parsed.error.issues.map((i) => i.message).slice(0, 5) } });
    return { value: parsed.data, providerId };
  }

  async translate(text: string, targetLanguage: string, signal?: AbortSignal): Promise<{ text: string; providerId: string }> {
    const system = 'You are a professional subtitle translator. Translate the user text faithfully and concisely. Reply with only the translation, preserving line breaks.';
    return this.complete({ system, prompt: `Translate to ${targetLanguage}:\n\n${text}`, signal });
  }

  /** Runs a real round-trip against the provider to verify credentials and reachability. */
  async test(id: string): Promise<{ ok: boolean; ms: number; message: string }> {
    const d = getDescriptor(id);
    if (!d) throw new AppError({ code: 'INVALID_INPUT', operation: 'providers.test', message: `Unknown provider ${id}` });
    if (!this.configured(d)) return { ok: false, ms: 0, message: 'Provider is not enabled or fully configured' };
    const t0 = Date.now();
    try {
      const text = await completeText(d, this.resolved(d), this.gateway, { system: 'You are a test.', prompt: 'Reply with the single word: ok', maxTokens: 8 });
      return { ok: true, ms: Date.now() - t0, message: text.trim().slice(0, 80) || 'ok' };
    } catch (err) {
      const info = AppError.from(err, { code: 'PROVIDER_FAILED', operation: 'providers.test' }).info;
      return { ok: false, ms: Date.now() - t0, message: info.message };
    }
  }

  // -------------------------------------------------------------------------------------------------- capabilities

  private registerCapabilities(): void {
    const textGate = (): Partial<CapabilityReport> => {
      if (this.hasTextProvider()) {
        const chosen = this.textProvider()!;
        return { status: 'available', providerId: chosen.descriptor.id, external: chosen.descriptor.external };
      }
      const anyEnabled = PROVIDER_DESCRIPTORS.some((d) => this.isEnabled(d.id));
      if (anyEnabled) return { status: 'needs-provider', reasonKey: 'capabilities.providerNeedsConfig', action: { type: 'open-providers', target: null } };
      return { status: 'needs-provider', reasonKey: 'capabilities.needsTextProvider', action: { type: 'open-providers', target: null } };
    };
    this.capabilities.register('llm.text', textGate);
    this.capabilities.register('translate', textGate);
  }
}
