import type { Brief, Character, CreatorScene, Script } from '@sevenstudios/core';
import type { Row, SqlDriver } from '../driver';
import { nowIso, parseJson, str } from './common';

function mapCharacter(row: Row): Character {
  return {
    id: String(row.id),
    name: String(row.name),
    bible: parseJson<Character['bible']>(row.bible_json, {} as Character['bible']),
    referenceImages: parseJson<string[]>(row.reference_images_json, []),
    hasEmbedding: row.embedding_blob != null,
  };
}

interface SceneMeta {
  voicePath: string | null;
  voiceMs: number | null;
  consistency: CreatorScene['consistency'];
}

function mapScene(row: Row): CreatorScene {
  const meta = parseJson<SceneMeta>(row.consistency_json, { voicePath: null, voiceMs: null, consistency: null });
  return {
    id: String(row.id),
    index: Number(row.order_index),
    scene: parseJson<CreatorScene['scene']>(row.scene_json, {} as CreatorScene['scene']),
    status: (String(row.status) as CreatorScene['status']) || 'draft',
    storyboardPath: str(row.storyboard_path),
    voicePath: meta.voicePath ?? null,
    voiceMs: meta.voiceMs ?? null,
    generatedAssetId: str(row.generated_asset_id),
    consistency: meta.consistency ?? null,
  };
}

function sceneMeta(s: CreatorScene): string {
  return JSON.stringify({ voicePath: s.voicePath, voiceMs: s.voiceMs, consistency: s.consistency } satisfies SceneMeta);
}

/** Persists the Creator's brief, script, characters and per-scene production state for a project. */
export class CreatorRepo {
  constructor(private readonly db: SqlDriver) {}

  getBriefScript(projectId: string): { brief: Brief | null; script: Script | null } {
    const row = this.db.prepare('SELECT brief_json, script_json FROM scripts WHERE project_id = ? ORDER BY version DESC LIMIT 1').get(projectId);
    if (!row) return { brief: null, script: null };
    return { brief: parseJson<Brief | null>(row.brief_json, null), script: parseJson<Script | null>(row.script_json, null) };
  }

  saveBriefScript(projectId: string, brief: Brief, script: Script): void {
    const latest = this.db.prepare('SELECT MAX(version) AS v FROM scripts WHERE project_id = ?').get(projectId);
    const version = (latest?.v != null ? Number(latest.v) : 0) + 1;
    this.db.prepare('INSERT INTO scripts (id, project_id, version, brief_json, script_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(`scr_${projectId}_${version}`, projectId, version, JSON.stringify(brief), JSON.stringify(script), nowIso());
  }

  characters(projectId: string): Character[] {
    return this.db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY created_at').all(projectId).map(mapCharacter);
  }

  upsertCharacter(projectId: string, c: Character, embedding: Buffer | null): void {
    const now = nowIso();
    this.db
      .prepare(
        'INSERT INTO characters (id, project_id, name, bible_json, reference_images_json, embedding_blob, generation_params_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET name = excluded.name, bible_json = excluded.bible_json, reference_images_json = excluded.reference_images_json, embedding_blob = COALESCE(excluded.embedding_blob, characters.embedding_blob), updated_at = excluded.updated_at',
      )
      .run(c.id, projectId, c.name, JSON.stringify(c.bible), JSON.stringify(c.referenceImages), embedding, null, now, now);
  }

  characterEmbedding(id: string): Buffer | null {
    const row = this.db.prepare('SELECT embedding_blob FROM characters WHERE id = ?').get(id);
    const blob = row?.embedding_blob;
    return blob instanceof Buffer ? blob : blob ? Buffer.from(blob as ArrayBuffer) : null;
  }

  removeCharacter(id: string): void {
    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  }

  scenes(projectId: string): CreatorScene[] {
    return this.db.prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY order_index').all(projectId).map(mapScene);
  }

  replaceScenes(projectId: string, scenes: CreatorScene[]): void {
    this.db.prepare('DELETE FROM scenes WHERE project_id = ?').run(projectId);
    const now = nowIso();
    for (const s of scenes) {
      this.db
        .prepare('INSERT INTO scenes (id, project_id, order_index, scene_json, status, storyboard_path, generated_asset_id, consistency_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(s.id, projectId, s.index, JSON.stringify(s.scene), s.status, s.storyboardPath, s.generatedAssetId, sceneMeta(s), now, now);
    }
  }

  updateScene(projectId: string, sceneId: string, patch: Partial<Pick<CreatorScene, 'status' | 'storyboardPath' | 'voicePath' | 'voiceMs' | 'generatedAssetId' | 'consistency' | 'scene'>>): void {
    const row = this.db.prepare('SELECT * FROM scenes WHERE id = ? AND project_id = ?').get(sceneId, projectId);
    if (!row) return;
    const current = mapScene(row);
    const next: CreatorScene = { ...current, ...patch };
    this.db
      .prepare('UPDATE scenes SET scene_json = ?, status = ?, storyboard_path = ?, generated_asset_id = ?, consistency_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(next.scene), next.status, next.storyboardPath, next.generatedAssetId, sceneMeta(next), nowIso(), sceneId);
  }

  clear(projectId: string): void {
    this.db.prepare('DELETE FROM scenes WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM scripts WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM characters WHERE project_id = ?').run(projectId);
  }
}
