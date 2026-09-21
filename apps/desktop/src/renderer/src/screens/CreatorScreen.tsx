import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { Clapperboard, Film, ImageIcon, Mic, Plus, RefreshCw, Sparkles, Trash2, Users, Wand2 } from 'lucide-react';
import type { Brief, Character, CreatorScene, Script } from '@sevenvid/core';
import type { CreatorState, TaskInfo } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useEvent } from '@/api/hooks';
import { CapabilityGate } from '@/components/CapabilityGate';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Input, Select, Switch } from '@/components/ui/Input';
import { EmptyState, PageHeader, Spinner } from '@/components/ui/Misc';
import { useAppStore } from '@/store/appStore';
import { useMediaStore } from '@/store/mediaStore';
import { useSessionStore } from '@/store/sessionStore';

type Stage = 'brief' | 'script' | 'characters' | 'produce' | 'review';
const STAGES: Stage[] = ['brief', 'script', 'characters', 'produce', 'review'];

export function CreatorScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const session = useSessionStore();
  const reportError = useAppStore((s) => s.reportError);
  const [state, setState] = useState<CreatorState | null>(null);
  const [stage, setStage] = useState<Stage>('brief');

  useEffect(() => {
    if (projectId && session.projectId !== projectId) void session.open(projectId);
  }, [projectId, session]);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const s = await getApi().invoke('creator.state', { projectId });
      setState(s);
      setStage((cur) => (cur === 'brief' && s.brief ? 'script' : cur));
    } catch (err) {
      reportError(err);
    }
  }, [projectId, reportError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  useEvent(
    'creator.updated',
    useCallback((e: { projectId: string }) => {
      if (e.projectId === projectId) void refresh();
    }, [projectId, refresh]),
  );

  if (!projectId) return <div className="mx-auto max-w-6xl px-8 py-8"><EmptyState icon={<Clapperboard />} title={t('creator.noProject')} /></div>;

  return (
    <div className="mx-auto max-w-6xl px-8 py-8" data-testid="creator-screen">
      <PageHeader
        title={t('creator.title')}
        subtitle={t('creator.subtitle')}
        actions={
          state?.brief ? (
            <Button action="creator.openEditor" size="sm" variant="outline" icon={<Film />} onClick={() => navigate(`/editor/${projectId}`)}>
              {t('creator.openInEditor')}
            </Button>
          ) : null
        }
      />

      {state?.brief ? (
        <div className="mb-6 flex items-center gap-1 overflow-x-auto" data-testid="creator-stepper">
          {STAGES.map((s, i) => (
            <button
              key={s}
              data-action={`creator.stage.${s}`}
              data-testid={`creator-stage-${s}`}
              onClick={() => setStage(s)}
              className={`focus-ring flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] ${stage === s ? 'bg-accent text-white' : 'text-muted hover:text-fg'}`}
            >
              <span className="font-mono text-[11px] opacity-70">{i + 1}</span>
              {t(`creator.stage.${s}`)}
            </button>
          ))}
        </div>
      ) : null}

      {state?.productionMode === 'animatic' ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]" data-testid="creator-mode-banner">
          <Sparkles className="size-4 text-warning" />
          {t('creator.animaticMode')}
        </div>
      ) : null}

      {!state ? (
        <div className="flex items-center gap-2 text-muted"><Spinner /> {t('common.loading')}</div>
      ) : !state.brief || stage === 'brief' ? (
        <BriefForm projectId={projectId} brief={state.brief} onDone={() => setStage('script')} />
      ) : stage === 'script' ? (
        <ScriptEditor projectId={projectId} script={state.script!} onSaved={refresh} />
      ) : stage === 'characters' ? (
        <CharactersEditor projectId={projectId} characters={state.characters} />
      ) : stage === 'produce' ? (
        <ProducePanel projectId={projectId} state={state} onAssembled={() => navigate(`/editor/${projectId}`)} />
      ) : (
        <ReviewPanel projectId={projectId} />
      )}
    </div>
  );
}

function BriefForm({ projectId, brief, onDone }: { projectId: string; brief: Brief | null; onDone: () => void }) {
  const { t } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const [form, setForm] = useState<Brief>(
    brief ?? { idea: '', language: 'ar', durationSec: 30, tone: 'neutral', style: 'cinematic', aspect: '9:16', narration: true, music: true, audience: '', callToAction: '' },
  );
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.idea.trim() || busy) return;
    setBusy(true);
    try {
      await getApi().invoke('creator.setBrief', { projectId, brief: form });
      onDone();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="creator-brief">
      <CardBody className="space-y-4">
        <Field label={t('creator.idea')} hint={t('creator.ideaHint')}>
          <textarea data-testid="creator-idea" value={form.idea} onChange={(e) => set('idea', e.target.value)} rows={4} className="focus-ring w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] outline-none" placeholder={t('creator.ideaPlaceholder')} />
        </Field>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label={t('creator.language')}>
            <Select value={form.language} data-testid="creator-language" onChange={(e) => set('language', e.target.value as Brief['language'])}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label={t('creator.duration')}>
            <Input type="number" min={5} max={1800} value={form.durationSec} data-testid="creator-duration" onChange={(e) => set('durationSec', Math.max(5, Number(e.target.value) || 30))} />
          </Field>
          <Field label={t('creator.aspect')} hint={t('creator.aspectHint')}>
            <Select value={form.aspect} data-testid="creator-aspect" onChange={(e) => set('aspect', e.target.value as Brief['aspect'])}>
              {['9:16', '16:9', '1:1', '4:5', '4:3'].map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </Field>
          <Field label={t('creator.tone')}>
            <Select value={form.tone} onChange={(e) => set('tone', e.target.value as Brief['tone'])}>
              {['neutral', 'energetic', 'calm', 'serious', 'playful', 'inspirational', 'dramatic'].map((v) => <option key={v} value={v}>{t(`creator.tones.${v}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('creator.style')}>
            <Select value={form.style} onChange={(e) => set('style', e.target.value as Brief['style'])}>
              {['cinematic', 'realistic', 'documentary', 'animation', 'minimal', 'vlog', 'corporate'].map((v) => <option key={v} value={v}>{t(`creator.styles.${v}`)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={t('creator.cta')}>
          <Input value={form.callToAction} onChange={(e) => set('callToAction', e.target.value)} placeholder={t('creator.ctaPlaceholder')} />
        </Field>
        <div className="flex gap-6">
          <Field inline label={t('creator.narration')}><Switch action="creator.narration" checked={form.narration} onCheckedChange={(v) => set('narration', v)} /></Field>
          <Field inline label={t('creator.music')}><Switch action="creator.music" checked={form.music} onCheckedChange={(v) => set('music', v)} /></Field>
        </div>
        <Button action="creator.build" variant="primary" icon={<Wand2 />} loading={busy} disabled={!form.idea.trim() || busy} onClick={() => void submit()} data-testid="creator-build">
          {t('creator.buildScript')}
        </Button>
      </CardBody>
    </Card>
  );
}

function ScriptEditor({ projectId, script, onSaved }: { projectId: string; script: Script; onSaved: () => void }) {
  const { t } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const [draft, setDraft] = useState<Script>(script);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDraft(script), [script]);
  const [busy, setBusy] = useState(false);
  const setScene = (id: string, patch: Partial<Script['scenes'][number]>) => setDraft((d) => ({ ...d, scenes: d.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const removeScene = (id: string) => setDraft((d) => ({ ...d, scenes: d.scenes.filter((s) => s.id !== id).map((s, i) => ({ ...s, index: i })) }));
  const save = async () => {
    setBusy(true);
    try {
      await getApi().invoke('creator.updateScript', { projectId, script: draft });
      onSaved();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3" data-testid="creator-script">
      <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} className="text-base font-semibold" />
      <p className="text-[12.5px] text-muted">{draft.logline}</p>
      {draft.scenes.map((s) => (
        <Card key={s.id} data-testid="creator-scene">
          <CardBody className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{s.index + 1}</Badge>
              <Input value={s.heading} onChange={(e) => setScene(s.id, { heading: e.target.value })} className="flex-1 font-medium" />
              <Input type="number" min={1} value={Math.round(s.durationMs / 1000)} onChange={(e) => setScene(s.id, { durationMs: Math.max(1000, (Number(e.target.value) || 1) * 1000) })} className="w-20" />
              <IconButton action="creator.scene.remove" label={t('common.delete')} size="sm" onClick={() => removeScene(s.id)}><Trash2 /></IconButton>
            </div>
            <textarea value={s.narration} onChange={(e) => setScene(s.id, { narration: e.target.value })} rows={2} className="focus-ring w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px] outline-none" placeholder={t('creator.narrationPlaceholder')} dir="auto" />
          </CardBody>
        </Card>
      ))}
      <Button action="creator.script.save" variant="primary" loading={busy} onClick={() => void save()} data-testid="creator-save-script">{t('creator.saveScript')}</Button>
    </div>
  );
}

function CharactersEditor({ projectId, characters }: { projectId: string; characters: Character[] }) {
  const { t } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const blank: Character = { id: '', name: '', bible: { age: '', gender: 'unspecified', appearance: '', hair: '', clothing: '', personality: '', voice: { engine: 'espeak', voice: '', rate: 165 } }, referenceImages: [], hasEmbedding: false };
  const [form, setForm] = useState<Character>(blank);
  const save = async () => {
    if (!form.name.trim()) return;
    try {
      await getApi().invoke('creator.saveCharacter', { projectId, character: form });
      setForm(blank);
    } catch (err) {
      reportError(err);
    }
  };
  const remove = async (id: string) => {
    try {
      await getApi().invoke('creator.removeCharacter', { projectId, characterId: id });
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <div className="space-y-4" data-testid="creator-characters">
      {characters.length === 0 ? <p className="text-[12.5px] text-muted">{t('creator.noCharacters')}</p> : null}
      {characters.map((c) => (
        <Card key={c.id} data-testid="character-card">
          <CardBody className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-accent" />
              <span className="font-medium">{c.name}</span>
              <span className="text-[12px] text-muted">{[c.bible.age, c.bible.appearance, c.bible.clothing].filter(Boolean).join(' · ')}</span>
              {c.hasEmbedding ? <Badge tone="success">{t('creator.hasReference')}</Badge> : null}
            </div>
            <IconButton action="creator.character.remove" label={t('common.delete')} size="sm" onClick={() => void remove(c.id)}><Trash2 /></IconButton>
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label={t('creator.charName')}><Input value={form.name} data-testid="character-name" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label={t('creator.charAge')}><Input value={form.bible.age} onChange={(e) => setForm((f) => ({ ...f, bible: { ...f.bible, age: e.target.value } }))} /></Field>
            <Field label={t('creator.charAppearance')}><Input value={form.bible.appearance} onChange={(e) => setForm((f) => ({ ...f, bible: { ...f.bible, appearance: e.target.value } }))} /></Field>
            <Field label={t('creator.charHair')}><Input value={form.bible.hair} onChange={(e) => setForm((f) => ({ ...f, bible: { ...f.bible, hair: e.target.value } }))} /></Field>
            <Field label={t('creator.charClothing')}><Input value={form.bible.clothing} onChange={(e) => setForm((f) => ({ ...f, bible: { ...f.bible, clothing: e.target.value } }))} /></Field>
            <Field label={t('creator.charVoiceRate')}><Input type="number" min={80} max={400} value={form.bible.voice.rate} onChange={(e) => setForm((f) => ({ ...f, bible: { ...f.bible, voice: { ...f.bible.voice, rate: Number(e.target.value) || 165 } } }))} /></Field>
          </div>
          <Button action="creator.character.save" variant="primary" icon={<Plus />} disabled={!form.name.trim()} onClick={() => void save()} data-testid="character-save">{t('creator.addCharacter')}</Button>
        </CardBody>
      </Card>
    </div>
  );
}

function ProducePanel({ projectId, state, onAssembled }: { projectId: string; state: CreatorState; onAssembled: () => void }) {
  const { t } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const [task, setTask] = useState<{ kind: string; id: string } | null>(null);
  const [progress, setProgress] = useState(0);

  useEvent(
    'task.updated',
    useCallback((tk: TaskInfo) => {
      if (!task || tk.id !== task.id) return;
      if (tk.status === 'running' || tk.status === 'queued') setProgress(tk.progress);
      else {
        if (tk.status === 'failed' && tk.error) useAppStore.getState().reportError(tk.error);
        if (tk.status === 'done' && task.kind === 'creator.assemble') onAssembled();
        setTask(null);
        setProgress(0);
      }
    }, [task, onAssembled]),
  );

  const start = async (kind: 'creator.storyboard' | 'creator.voice' | 'creator.assemble') => {
    if (task) return;
    try {
      const info = await getApi().invoke(kind, { projectId });
      setTask({ kind, id: info.id });
    } catch (err) {
      reportError(err);
    }
  };

  const running = (kind: string) => task?.kind === kind;
  return (
    <div className="space-y-4" data-testid="creator-produce">
      {/* Storyboard rendering and assembly both drive FFmpeg. Gate the whole action row on it so a missing
          FFmpeg shows an honest reason and a next step (open System) instead of a button that silently fails. */}
      <CapabilityGate id="render.export" compact>
        <div className="flex flex-wrap gap-2">
          <Button action="creator.storyboard" variant="outline" icon={<ImageIcon />} loading={running('creator.storyboard')} disabled={Boolean(task)} onClick={() => void start('creator.storyboard')} data-testid="creator-storyboard">{t('creator.renderStoryboard')}</Button>
          <CapabilityGate id="tts" compact>
            <Button action="creator.voice" variant="outline" icon={<Mic />} loading={running('creator.voice')} disabled={Boolean(task)} onClick={() => void start('creator.voice')} data-testid="creator-voice">{t('creator.synthVoice')}</Button>
          </CapabilityGate>
          <Button action="creator.assemble" variant="primary" icon={<Clapperboard />} loading={running('creator.assemble')} disabled={Boolean(task)} onClick={() => void start('creator.assemble')} data-testid="creator-assemble">{t('creator.assemble')}</Button>
        </div>
      </CapabilityGate>
      {task ? (
        <div data-testid="creator-progress">
          <div className="h-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {state.scenes.map((s) => <SceneCard key={s.id} scene={s} />)}
      </div>
    </div>
  );
}

function SceneCard({ scene }: { scene: CreatorScene }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!scene.storyboardPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(null);
      return;
    }
    void useMediaStore.getState().urlFor(scene.storyboardPath).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [scene.storyboardPath]);
  const tone = scene.status === 'assembled' ? 'success' : scene.status === 'voiced' ? 'accent' : scene.status === 'storyboard' ? 'neutral' : 'warning';
  return (
    <Card data-testid="scene-card" data-status={scene.status}>
      <div className="aspect-video overflow-hidden rounded-t-xl bg-surface-2">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" data-testid="scene-thumb" /> : <div className="flex h-full items-center justify-center text-muted"><ImageIcon className="size-6" /></div>}
      </div>
      <CardBody className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium">{scene.index + 1}. {scene.scene.heading}</span>
          <Badge tone={tone}>{t(`creator.status.${scene.status}`)}</Badge>
        </div>
        <p className="line-clamp-2 text-[11.5px] text-muted" dir="auto">{scene.scene.narration}</p>
        {scene.voiceMs ? <span className="text-[10.5px] text-muted" dir="ltr">🎙 {(scene.voiceMs / 1000).toFixed(1)}s</span> : null}
      </CardBody>
    </Card>
  );
}

function ReviewPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const [issues, setIssues] = useState<Array<{ severity: string; code: string; messageAr: string; messageEn: string }> | null>(null);
  const { i18n } = useTranslation();
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en';
  const run = useCallback(async () => {
    try {
      const r = await getApi().invoke('creator.review', { projectId });
      setIssues(r.issues);
    } catch (err) {
      reportError(err);
    }
  }, [projectId, reportError]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);
  return (
    <div className="space-y-3" data-testid="creator-review">
      <Button action="creator.review.refresh" size="sm" variant="outline" icon={<RefreshCw />} onClick={() => void run()}>{t('creator.recheck')}</Button>
      {issues === null ? (
        <div className="flex items-center gap-2 text-muted"><Spinner /> {t('common.loading')}</div>
      ) : issues.length === 0 ? (
        <div className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[13px] text-success" data-testid="review-clean">{t('creator.reviewClean')}</div>
      ) : (
        issues.map((iss, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px]" data-testid="review-issue" data-severity={iss.severity}>
            <Badge tone={iss.severity === 'error' ? 'danger' : 'warning'}>{t(`creator.severity.${iss.severity}`)}</Badge>
            <span dir="auto">{lang === 'ar' ? iss.messageAr : iss.messageEn}</span>
          </div>
        ))
      )}
    </div>
  );
}
