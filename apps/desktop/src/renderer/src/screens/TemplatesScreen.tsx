import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutTemplate, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { TemplateInfo } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { useSessionStore } from '@/store/sessionStore';
import { formatDuration } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Input';
import { EmptyState, PageHeader } from '@/components/ui/Misc';
import { CreateProjectDialog } from './ProjectsScreen';

export function TemplatesScreen() {
  const { t, i18n } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const session = useSessionStore((s) => s.state);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [useTemplate, setUseTemplate] = useState<TemplateInfo | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [trendsOpen, setTrendsOpen] = useState(false);
  const [trendUrl, setTrendUrl] = useState('');
  const [enableTrends, setEnableTrends] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const load = useCallback(() => getApi().invoke('templates.list').then(setTemplates).catch(reportError), [reportError]);
  useEffect(() => {
    void load();
  }, [load]);
  const ar = i18n.language === 'ar';
  const remove = async (tpl: TemplateInfo) => {
    if (!window.confirm(t('templates.deleteConfirm', { name: tpl.name }))) return;
    try {
      await getApi().invoke('templates.delete', { templateId: tpl.id });
      await load();
    } catch (err) {
      reportError(err);
    }
  };
  const syncTrends = async () => {
    if (!trendUrl.trim()) return;
    setSyncing(true);
    try {
      if (enableTrends) await getApi().invoke('settings.update', { patch: { privacy: { allowTrends: true } } });
      const result = await getApi().invoke('trends.sync', { url: trendUrl.trim() });
      setTrendsOpen(false);
      await load();
      useAppStore.getState().pushToast({ level: 'success', titleKey: 'templates.trends.synced', messageKey: null, params: { added: result.added, updated: result.updated }, errorId: null, taskId: null });
    } catch (err) {
      reportError(err);
    } finally {
      setSyncing(false);
    }
  };
  const save = async () => {
    if (!session || !saveName.trim()) return;
    try {
      await getApi().invoke('templates.saveFromProject', { projectId: session.projectId, name: saveName.trim(), category: 'custom' });
      setSaveOpen(false);
      setSaveName('');
      await load();
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('templates.title')} subtitle={t('templates.subtitle')} actions={
        <>
          <Button action="templates.syncTrends" variant="outline" icon={<RefreshCw />} onClick={() => setTrendsOpen(true)}>{t('templates.trends.sync')}</Button>
          <Button action="templates.saveCurrent" icon={<Save />} disabled={!session} onClick={() => setSaveOpen(true)}>{t('templates.saveCurrent')}</Button>
        </>
      } />
      {templates.length === 0 ? <EmptyState icon={<LayoutTemplate />} title={t('templates.empty')} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <div key={tpl.id} className="flex flex-col rounded-xl border border-border bg-surface p-5" data-testid="template-card">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Badge tone="accent">{t(`templates.category.${tpl.category}`, { defaultValue: tpl.category })}</Badge>
                <div className="flex items-center gap-1">
                  <Badge tone="neutral">{tpl.builtin ? t('templates.builtin') : t('templates.custom')}</Badge>
                  {!tpl.builtin ? <IconButton action="templates.delete" label={t('common.delete')} size="sm" onClick={() => void remove(tpl)}><Trash2 /></IconButton> : null}
                </div>
              </div>
              <h3 className="text-[15px] font-semibold">{ar && tpl.nameAr ? tpl.nameAr : tpl.name}</h3>
              <p className="mt-1 flex-1 text-[13px] text-muted">{ar && tpl.descriptionAr ? tpl.descriptionAr : tpl.description}</p>
              <div className="mt-3 text-[12px] text-faint">
                {tpl.settings ? `${tpl.settings.width}×${tpl.settings.height} · ${tpl.settings.fps} fps` : '—'}
                {tpl.targetDurationMs ? ` · ${t('templates.targetDuration')} ${formatDuration(tpl.targetDurationMs)}` : ''}
              </div>
              <Button action="templates.use" data-template={tpl.id} variant="primary" size="sm" className="mt-4" onClick={() => setUseTemplate(tpl)}>{t('templates.use')}</Button>
            </div>
          ))}
        </div>
      )}
      <CreateProjectDialog open={Boolean(useTemplate)} onClose={() => setUseTemplate(null)} templateId={useTemplate?.id ?? null} defaults={{ platformPreset: useTemplate?.platformPreset ?? 'custom' }} />
      <Dialog open={saveOpen} onOpenChange={setSaveOpen} title={t('templates.saveCurrent')} size="sm" footer={
        <>
          <Button action="templates.save.cancel" variant="ghost" onClick={() => setSaveOpen(false)}>{t('common.cancel')}</Button>
          <Button action="templates.save.submit" variant="primary" disabled={!saveName.trim()} onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }>
        <Field label={t('common.name')}><Input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} /></Field>
      </Dialog>
      <Dialog open={trendsOpen} onOpenChange={setTrendsOpen} title={t('templates.trends.sync')} size="sm" footer={
        <>
          <Button action="templates.trends.cancel" variant="ghost" onClick={() => setTrendsOpen(false)}>{t('common.cancel')}</Button>
          <Button action="templates.trends.submit" variant="primary" disabled={!trendUrl.trim() || syncing} onClick={() => void syncTrends()}>{syncing ? t('templates.trends.syncing') : t('templates.trends.sync')}</Button>
        </>
      }>
        <p className="mb-3 text-[12.5px] text-muted">{t('templates.trends.note')}</p>
        <Field label={t('templates.trends.url')}><Input autoFocus dir="ltr" placeholder="https://…" value={trendUrl} onChange={(e) => setTrendUrl(e.target.value)} /></Field>
        <label className="mt-3 flex items-center gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={enableTrends} onChange={(e) => setEnableTrends(e.target.checked)} className="size-3.5 accent-accent" data-testid="templates-trends-enable" />
          {t('templates.trends.enable')}
        </label>
      </Dialog>
    </div>
  );
}
