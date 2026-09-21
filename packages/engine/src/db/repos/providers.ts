import type { Row, SqlDriver } from '../driver';
import { fromBool, nowIso, parseJson, toBool } from './common';

export interface StoredProviderConfig {
  baseUrl: string;
  model: string;
  /** API key / token, stored encrypted when the host offers secret storage, otherwise plaintext (flagged). */
  secret: string;
  secretEncrypted: boolean;
  extra: Record<string, string>;
}

export interface ProviderConfigRow {
  providerId: string;
  enabled: boolean;
  config: StoredProviderConfig;
  updatedAt: string;
}

const EMPTY: StoredProviderConfig = { baseUrl: '', model: '', secret: '', secretEncrypted: false, extra: {} };

function map(row: Row): ProviderConfigRow {
  return {
    providerId: String(row.provider_id),
    enabled: toBool(row.enabled),
    config: { ...EMPTY, ...parseJson<Partial<StoredProviderConfig>>(row.config_json, {}) },
    updatedAt: String(row.updated_at),
  };
}

/** Persists per-provider enablement and configuration (base URL, model, secret) for external AI providers. */
export class ProvidersRepo {
  constructor(private readonly db: SqlDriver) {}

  list(): ProviderConfigRow[] {
    return this.db.prepare('SELECT * FROM providers_config ORDER BY provider_id').all().map(map);
  }

  get(providerId: string): ProviderConfigRow | null {
    const row = this.db.prepare('SELECT * FROM providers_config WHERE provider_id = ?').get(providerId);
    return row ? map(row) : null;
  }

  set(providerId: string, enabled: boolean, config: StoredProviderConfig): void {
    this.db
      .prepare('INSERT INTO providers_config (provider_id, enabled, config_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(provider_id) DO UPDATE SET enabled = excluded.enabled, config_json = excluded.config_json, updated_at = excluded.updated_at')
      .run(providerId, fromBool(enabled), JSON.stringify(config), nowIso());
  }
}
