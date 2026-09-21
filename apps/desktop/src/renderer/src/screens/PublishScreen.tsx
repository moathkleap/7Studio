import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, FolderOpen, Play, Share2, XCircle } from 'lucide-react';
import type { PublishPackage, PublishTargetInfo } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useEvent } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { formatDuration } from '@/lib/format';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Progress, Select } from '@/components/ui/Input';
import { EmptyState, PageHeader } from '@/components/ui/Misc';
import { CapabilityGate } from '@/components/CapabilityGate';
import { cn } from '@/lib/cn';

const statusTone: Record<PublishPackage['status'], BadgeTone> = { queued: 'neutral', running: 'accent', done: 'success', failed: 'danger' };

export function PublishScreen() {
  const { t } = useTranslation();
  const session = useSessionStore((s) => s.state);
  const tasks = useAppStore((s) => s.tasks);
  const reportError = useAppStore((s) => s.reportError);
  const [targets, setTargets] = useState<PublishTargetInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [strategy, setStrategy] = useState<'auto' | 'crop' | 'fit'>('auto');
  const [soundName, setSoundName] = useState('');
  const [soundUrl, setSoundUrl] = useState('');
  const [soundLicensed, setSoundLicensed] = useState(false);
  const [packages, setPackages] = useState<PublishPackage[]>([]);

  const loadTargets = useCallback(() => {
    getApi().invoke('publish.targets', { projectId: session?.projectId ?? null }).then(setTargets).catch(reportError);
  }, [session?.projectId, reportError]);
  const loadPackages = useCallback(() => {
    getApi().invoke('publish.recent', { limit: 30 }).then(setPackages).catch(reportError);
  }, [reportError]);

  useEffect(() => {
    loadTargets();
    loadPackages();
  }, [loadTargets, loadPackages]);
  useEvent('publish.changed', useCallback(() => loadPackages(), [loadPackages]));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const build = async () => {
    if (!session || selected.size === 0) return;
    const sound = soundName.trim() ? { name: soundName.trim(), url: soundUrl.trim() || null, licensed: soundLicensed, source: null } : undefined;
    try {
      for (const targetId of selected) {
        await getApi().invoke('publish.build', {
          projectId: session.projectId,
          targetId,
          strategy: strategy === 'auto' ? undefined : strategy,
          caption: caption || undefined,
          hashtags: hashtags || undefined,
          sound,
        });
      }
      await loadPackages();
    } catch (err) {
      reportError(err);
    }
  };

  const suggestAlternative = async () => {
    const tags = hashtags.split(/[\s,#]+/).map((x) => x.trim()).filter(Boolean);
    try {
      const track = await getApi().invoke('music.suggest', { tags });
      if (track) {
        setSoundName(track.name);
        setSoundUrl(track.file);
        setSoundLicensed(true);
      } else {
        useAppStore.getState().pushToast({ level: 'info', titleKey: 'publish.soundNoAlt', messageKey: null, params: {}, errorId: null, taskId: null });
      }
    } catch (err) {
      reportError(err);
    }
  };

  const targetName = (p: PublishTargetInfo | undefined, id: string) => (p ? t(p.nameKey) : id);
  const byId = useMemo(() => new Map(targets.map((x) => [x.id, x])), [targets]);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('publish.title')} subtitle={t('publish.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={session ? session.document.name : t('publish.noProject')} subtitle={session ? `${session.document.settings.width}×${session.document.settings.height}` : undefined} />
          <CardBody>
            <CapabilityGate id="render.export">
              {!session ? (
                <EmptyState title={t('publish.noProject')} className="py-8" />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2" data-testid="publish-targets">
                    {targets.map((tg) => {
                      const on = selected.has(tg.id);
                      return (
                        <button
                          key={tg.id}
                          type="button"
                          data-action="publish.toggle"
                          data-target={tg.id}
                          data-selected={on}
                          onClick={() => toggle(tg.id)}
                          className={cn('focus-ring rounded-xl border p-3 text-start transition-colors', on ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2 hover:bg-surface-3')}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] font-medium">{t(tg.nameKey)}</span>
                            <span className="font-mono text-[11px] text-faint" dir="ltr">{tg.width}×{tg.height}</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <Badge tone="neutral">{tg.aspectLabel}</Badge>
                            {tg.fit?.needsReframe ? <Badge tone="info">{t('publish.needsReframe', { aspect: tg.aspectLabel })}</Badge> : <Badge tone="success">{t('publish.sameAspect')}</Badge>}
                            {tg.fit?.willTrim ? <Badge tone="warning">{t('publish.willTrim', { seconds: Math.round((tg.maxDurationMs ?? 0) / 1000) })}</Badge> : null}
                            {tg.fit?.upscales ? <Badge tone="warning">{t('publish.upscales')}</Badge> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 grid gap-3">
                    <Field label={t('publish.caption')}>
                      <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={t('publish.captionPlaceholder')} rows={3} data-testid="publish-caption" dir="auto" className="focus-ring w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] outline-none" />
                    </Field>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <Field label={t('publish.hashtags')}>
                        <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder={t('publish.hashtagsPlaceholder')} data-testid="publish-hashtags" />
                      </Field>
                      <Field label={t('publish.strategy')}>
                        <Select value={strategy} onChange={(e) => setStrategy(e.target.value as 'auto' | 'crop' | 'fit')} data-testid="publish-strategy">
                          <option value="auto">{t('common.auto')}</option>
                          <option value="crop">{t('publish.crop')}</option>
                          <option value="fit">{t('publish.fit')}</option>
                        </Select>
                      </Field>
                    </div>
                    <div className="rounded-lg border border-border bg-surface-2 p-3" data-testid="publish-sound">
                      <div className="text-[13px] font-medium">{t('publish.soundTitle')}</div>
                      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <Field label={t('publish.soundName')}>
                          <Input value={soundName} onChange={(e) => setSoundName(e.target.value)} placeholder={t('publish.soundNamePlaceholder')} data-testid="publish-sound-name" dir="auto" />
                        </Field>
                        <Field label={t('publish.soundUrl')}>
                          <Input value={soundUrl} onChange={(e) => setSoundUrl(e.target.value)} placeholder={t('publish.soundUrlPlaceholder')} data-testid="publish-sound-url" dir="ltr" />
                        </Field>
                      </div>
                      <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                        <input type="checkbox" checked={soundLicensed} onChange={(e) => setSoundLicensed(e.target.checked)} data-testid="publish-sound-licensed" className="size-3.5 accent-accent" />
                        {t('publish.soundLicensed')}
                      </label>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="text-[11.5px] text-faint">{t('publish.soundNote')}</div>
                        <Button action="publish.suggestAlt" size="sm" variant="ghost" onClick={() => void suggestAlternative()} data-testid="publish-sound-suggest">{t('publish.soundSuggestAlt')}</Button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <Button action="publish.build" variant="primary" size="lg" icon={<Share2 />} disabled={selected.size === 0} onClick={() => void build()} data-testid="publish-build">
                      {t('publish.buildAll')} {selected.size > 0 ? `(${selected.size})` : ''}
                    </Button>
                  </div>
                </>
              )}
            </CapabilityGate>
          </CardBody>
        </Card>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader title={t('publish.results')} />
            <CardBody>
              {packages.length === 0 ? (
                <EmptyState title={t('publish.noResults')} className="py-6" />
              ) : (
                <ul className="flex flex-col gap-2" data-testid="publish-list">
                  {packages.map((p) => {
                    const task = p.taskId ? tasks[p.taskId] : undefined;
                    const validation = p.validation as { checks?: Array<{ name: string; ok: boolean; detail: string }> } | null;
                    return (
                      <li key={p.id} className="rounded-lg border border-border bg-surface-2 p-3" data-testid="publish-row" data-status={p.status}>
                        <div className="flex items-center gap-2">
                          <Badge tone={statusTone[p.status]} dot>{t(`publish.${p.status === 'running' ? 'running' : p.status}`)}</Badge>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{targetName(byId.get(p.targetId), p.targetId)}</span>
                          <span className="font-mono text-[11px] text-faint" dir="ltr">{p.width}×{p.height}</span>
                        </div>
                        {(p.status === 'running' || p.status === 'queued') && task ? (
                          <div className="mt-2">
                            <Progress value={task.progress} />
                            <div className="mt-1 text-[11.5px] text-muted">{task.progressMessage ?? ''} · {Math.round(task.progress * 100)}%</div>
                          </div>
                        ) : null}
                        {p.status === 'done' ? (
                          <div className="mt-2 text-[12px]">
                            <div className="text-muted">{formatDuration(p.durationMs)}{p.trimmed ? ` · ${t('publish.willTrim', { seconds: Math.round(p.durationMs / 1000) })}` : ''}</div>
                            {validation?.checks ? (
                              <ul className="mt-1 flex flex-wrap gap-1" data-testid="publish-validation">
                                {validation.checks.map((c) => <li key={c.name} className={cn('flex items-center gap-1 rounded px-1.5 py-0.5', c.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')} title={c.detail}>{c.ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}{c.name}</li>)}
                              </ul>
                            ) : null}
                            {p.suggestedSound ? <div className="mt-1 text-muted">{t('publish.soundSuggested', { name: p.suggestedSound.name })}{p.suggestedSound.url ? <> · <a href={p.suggestedSound.url} target="_blank" rel="noreferrer" className="text-accent underline" onClick={(e) => { e.preventDefault(); void getApi().invoke('shell.openExternal', { url: p.suggestedSound!.url! }).catch(reportError); }}>{p.suggestedSound.url}</a></> : null}</div> : null}
                            {p.warnings.length ? <div className="mt-1 text-warning">{t('publish.warnings')}: {p.warnings.join('; ')}</div> : null}
                            <div className="mt-2 flex gap-1">
                              <Button action="publish.play" size="sm" variant="outline" icon={<Play />} onClick={() => void getApi().invoke('shell.openPath', { path: p.videoPath }).catch(reportError)}>{t('publish.openVideo')}</Button>
                              <Button action="publish.openFolder" size="sm" variant="ghost" icon={<FolderOpen />} onClick={() => void getApi().invoke('shell.showInFolder', { path: p.videoPath }).catch(reportError)}>{t('publish.openFolder')}</Button>
                            </div>
                          </div>
                        ) : null}
                        {p.error ? <div className="mt-2 text-[12px] text-danger">{p.error}</div> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
