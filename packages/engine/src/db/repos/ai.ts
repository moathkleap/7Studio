import type { AssistantPlan, PlanRunResult } from '@sevenstudios/ipc';
import type { Row, SqlDriver } from '../driver';
import { nowIso, parseJson, str } from './common';

export interface AiMessageRow {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  planId: string | null;
  plan: AssistantPlan | null;
  result: PlanRunResult | null;
  createdAt: string;
}

function mapMessage(row: Row): AiMessageRow {
  const interpretation = parseJson<{ plan: AssistantPlan | null; result: PlanRunResult | null }>(row.interpretation_json, { plan: null, result: null });
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: String(row.content),
    planId: str(row.plan_id),
    plan: interpretation.plan ?? null,
    result: interpretation.result ?? null,
    createdAt: String(row.created_at),
  };
}

/** Stores AI assistant conversations, messages, plans and their run results (one conversation per project). */
export class AiRepo {
  constructor(private readonly db: SqlDriver) {}

  /** Returns the project's single conversation, creating it on first use. */
  conversation(projectId: string): string {
    const existing = this.db.prepare('SELECT id FROM ai_conversations WHERE project_id = ? ORDER BY created_at LIMIT 1').get(projectId);
    if (existing) return String(existing.id);
    const id = `conv_${projectId}`;
    const now = nowIso();
    this.db.prepare('INSERT INTO ai_conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, projectId, null, now, now);
    return id;
  }

  addMessage(m: Omit<AiMessageRow, 'createdAt'>): AiMessageRow {
    const createdAt = nowIso();
    this.db
      .prepare('INSERT INTO ai_messages (id, conversation_id, role, content, interpretation_json, plan_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.conversationId, m.role, m.content, JSON.stringify({ plan: m.plan, result: m.result }), m.planId, createdAt);
    this.db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(createdAt, m.conversationId);
    return { ...m, createdAt };
  }

  updateMessage(id: string, patch: { plan?: AssistantPlan | null; result?: PlanRunResult | null }): void {
    const row = this.db.prepare('SELECT * FROM ai_messages WHERE id = ?').get(id);
    if (!row) return;
    const current = mapMessage(row);
    const plan = patch.plan !== undefined ? patch.plan : current.plan;
    const result = patch.result !== undefined ? patch.result : current.result;
    this.db.prepare('UPDATE ai_messages SET interpretation_json = ?, plan_id = ? WHERE id = ?').run(JSON.stringify({ plan, result }), plan?.id ?? current.planId, id);
  }

  messages(projectId: string): AiMessageRow[] {
    const conv = this.db.prepare('SELECT id FROM ai_conversations WHERE project_id = ? ORDER BY created_at LIMIT 1').get(projectId);
    if (!conv) return [];
    return this.db.prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at').all(String(conv.id)).map(mapMessage);
  }

  savePlan(plan: AssistantPlan): void {
    const now = nowIso();
    this.db
      .prepare(
        'INSERT INTO ai_plans (id, conversation_id, message_id, project_id, operations_json, status, requires_confirmation, summary_ar, summary_en, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET operations_json = excluded.operations_json, status = excluded.status, requires_confirmation = excluded.requires_confirmation, summary_ar = excluded.summary_ar, summary_en = excluded.summary_en, updated_at = excluded.updated_at',
      )
      .run(plan.id, plan.conversationId, plan.messageId, plan.projectId, JSON.stringify(plan), plan.status, plan.requiresConfirmation ? 1 : 0, plan.summaryAr, plan.summaryEn, null, now, now);
  }

  getPlan(id: string): AssistantPlan | null {
    const row = this.db.prepare('SELECT operations_json FROM ai_plans WHERE id = ?').get(id);
    return row ? (parseJson<AssistantPlan | null>(row.operations_json, null)) : null;
  }

  setPlanStatus(id: string, status: AssistantPlan['status'], result: PlanRunResult | null): void {
    const now = nowIso();
    this.db.prepare('UPDATE ai_plans SET status = ?, result_json = ?, updated_at = ? WHERE id = ?').run(status, result ? JSON.stringify(result) : null, now, id);
  }

  clear(projectId: string): void {
    const conv = this.db.prepare('SELECT id FROM ai_conversations WHERE project_id = ? ORDER BY created_at LIMIT 1').get(projectId);
    if (!conv) return;
    this.db.prepare('DELETE FROM ai_messages WHERE conversation_id = ?').run(String(conv.id));
    this.db.prepare('DELETE FROM ai_plans WHERE conversation_id = ?').run(String(conv.id));
  }
}
