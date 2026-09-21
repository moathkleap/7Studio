import { trendItemToTemplate, type TrendFeedItem } from '@sevenstudios/core';
import type { AppDatabase } from '../db/database';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';
import type { NetworkGateway } from '../network/NetworkGateway';
import type { SearchService } from '../search/SearchService';

export interface TrendSyncResult {
  added: number;
  updated: number;
  skipped: number;
  total: number;
  sourceHost: string;
  at: string;
}

/**
 * Syncs trend templates from an opt-in feed through the privacy-aware NetworkGateway. Nothing is fetched
 * unless trend sync is enabled in Privacy settings; every request is logged. Feed items are normalized into
 * `category: "trend"` templates with stable ids, so a re-sync updates rather than duplicates. Only trend
 * metadata (canvas, captions, hook, hashtags, a suggested sound) is stored — no copyrighted audio is ever
 * downloaded or embedded.
 */
export class TrendsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly gateway: NetworkGateway,
    private readonly search: SearchService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  /** Upserts normalized feed items as trend templates. Pure of the network, so it is directly testable. */
  ingest(items: TrendFeedItem[], sourceHost: string): TrendSyncResult {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const item of items) {
      const template = trendItemToTemplate(item, sourceHost);
      if (!template) {
        skipped += 1;
        continue;
      }
      const id = String(template.id);
      const existed = Boolean(this.db.templates.get(id));
      this.db.templates.upsert({ id, name: String(template.name), category: 'trend', builtin: false, thumbnailPath: null, template });
      this.search.index({ type: 'template', id, projectId: null, title: String(template.name), body: `trend ${String(template.description ?? '')}` });
      if (existed) updated += 1;
      else added += 1;
    }
    const result: TrendSyncResult = { added, updated, skipped, total: items.length, sourceHost, at: new Date().toISOString() };
    this.bus.emit('trends.changed', { added, updated });
    this.logger.info({ module: 'trends', operation: 'ingest', ...result }, 'trend templates ingested');
    return result;
  }

  /** Fetches a trends feed over the gateway and ingests it. The feed is a JSON array or `{ items: [...] }`. */
  async sync(url: string): Promise<TrendSyncResult> {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      throw new AppError({ code: 'INVALID_INPUT', operation: 'trends.sync', message: `Invalid trends feed URL: ${url}` });
    }
    const { json } = await this.gateway.fetchJson<unknown>(url, { purpose: 'trends:sync', providerId: null, method: 'GET' });
    const items = Array.isArray(json) ? json : Array.isArray((json as { items?: unknown }).items) ? (json as { items: unknown[] }).items : null;
    if (!items) {
      throw new AppError({ code: 'VALIDATION_FAILED', operation: 'trends.sync', message: 'Trends feed must be a JSON array or an object with an "items" array', details: { host } });
    }
    return this.ingest(items as TrendFeedItem[], host);
  }
}
