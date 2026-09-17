import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { CheckCircle2, Clapperboard, FolderOpen, Layers, Plus, ShieldCheck, Trash2, Volume2, Film } from 'lucide-react';
import { fpsToNumber, getDocumentDurationMs, type Track } from '@sevenvid/core';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { formatDuration } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, PageHeader, Spinner, StatRow } from '@/components/ui/Misc';
import { PhaseNotice } from '@/components/CapabilityGate';

export function EditorScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const session = useSessionStore();
  const reportError = useAppStore((s) => s.reportError);
  const [validationAt, setValidationAt] = useState<{ revision: number; result: { ok: boolean; errors: number; warnings: number; issues: Array<Record<string, unknown>> } } | null>(null);
  useEffect(() => {
    if (projectId && session.projectId !== projectId) void session.open(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  if (!projectId && !session.state) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16">
        <EmptyState icon={<Clapperboard />} title={t('editor.noProject')} description={t('editor.openOrCreate')} action={<Button action="editor.openProjects" variant="primary" icon={<FolderOpen />} onClick={() => navigate('/projects')}>{t('projects.title')}</Button>} />
      </div>
    );
  }
  const state = session.state;
  if (!state) return <div className="grid h-full place-items-center"><Spinner /></div>;
  const doc = state.document;
  const validation = validationAt && validationAt.revision === state.revision ? validationAt.result : null;
  const validate = async () => {
    try {
      const result = await getApi().invoke('session.validate', { projectId: doc.id });
      setValidationAt({ revision: state.revision, result });
    } catch (err) {
      reportError(err);
    }
  };
  const addTrack = (kind: Track['kind']) => void session.execute({ type: 'track.add', kind });
  const removeTrack = (trackId: string) => void session.execute({ type: 'track.remove', trackId });
  const assets = Object.values(doc.assets);
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={doc.name} subtitle={t('editor.title')} actions={<Button action="editor.validate" variant="outline" icon={<ShieldCheck />} onClick={() => void validate()}>{t('editor.validate')}</Button>} />
      {validation ? (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm" data-testid="editor-validation">
          <CheckCircle2 className={validation.ok ? 'size-4 text-success' : 'size-4 text-warning'} />
          <span>{validation.ok && validation.warnings === 0 ? t('editor.valid') : t('editor.issues', { errors: validation.errors, warnings: validation.warnings })}</span>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('editor.projectInfo')} />
          <CardBody>
            <StatRow label={t('editor.resolution')} value={<span data-testid="editor-resolution">{doc.settings.width}×{doc.settings.height}</span>} />
            <StatRow label={t('editor.fps')} value={fpsToNumber(doc.settings.fps).toFixed(2).replace(/\.00$/, '')} />
            <StatRow label={t('editor.duration')} value={formatDuration(getDocumentDurationMs(doc))} />
            <StatRow label={t('projects.platform')} value={t(`presets.platform.${doc.settings.platformPreset === 'instagram-post' ? 'instagramPost' : doc.settings.platformPreset}`)} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t('editor.tracks')} actions={
            <>
              <Button action="editor.addTrack.video" size="sm" icon={<Plus />} onClick={() => addTrack('video')}>{t('editor.trackKind.video')}</Button>
              <Button action="editor.addTrack.audio" size="sm" icon={<Plus />} onClick={() => addTrack('audio')}>{t('editor.trackKind.audio')}</Button>
              <Button action="editor.addTrack.overlay" size="sm" icon={<Plus />} onClick={() => addTrack('overlay')}>{t('editor.trackKind.overlay')}</Button>
            </>
          } />
          <CardBody>
            <ul className="divide-y divide-border" data-testid="editor-tracks">
              {doc.tracks.map((track) => (
                <li key={track.id} className="flex items-center gap-3 py-2" data-testid="editor-track-row">
                  {track.kind === 'video' ? <Film className="size-4 text-accent" /> : track.kind === 'audio' ? <Volume2 className="size-4 text-success" /> : <Layers className="size-4 text-info" />}
                  <span className="w-16 font-medium">{track.name}</span>
                  <Badge tone="neutral">{t(`editor.trackKind.${track.kind}`)}</Badge>
                  <span className="text-[12.5px] text-muted">{track.clips.length} {t('editor.clips')}</span>
                  <IconButton action="editor.removeTrack" label={t('common.delete')} size="sm" className="ms-auto" onClick={() => removeTrack(track.id)}><Trash2 /></IconButton>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title={t('editor.assets')} />
          <CardBody>{assets.length === 0 ? <EmptyState title={t('editor.noAssets')} className="py-6" /> : <ul className="text-sm">{assets.map((a) => <li key={a.id} className="py-1">{a.name}</li>)}</ul>}</CardBody>
        </Card>
        <div className="lg:col-span-3">
          <PhaseNotice phase={2} feature={t('editor.title')} />
        </div>
      </div>
    </div>
  );
}
