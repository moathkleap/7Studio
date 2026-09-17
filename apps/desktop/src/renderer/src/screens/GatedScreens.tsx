import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import type { ExportInfo } from '@sevenvid/ipc';
import { CAPABILITY_IDS } from '@sevenvid/core';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { CapabilityBadge, PhaseNotice } from '@/components/CapabilityGate';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, PageHeader, StatRow } from '@/components/ui/Misc';
import { formatBytes, formatDate } from '@/lib/format';

export function CreatorScreen() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('creator.title')} subtitle={t('creator.subtitle')} />
      <PhaseNotice phase={5} feature={t('creator.title')} />
    </div>
  );
}

export function MediaScreen() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('media.title')} subtitle={t('media.subtitle')} />
      <PhaseNotice phase={2} feature={t('media.title')} />
    </div>
  );
}

export function ModelsScreen() {
  const { t } = useTranslation();
  const capabilities = useAppStore((s) => s.capabilities);
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('models.title')} subtitle={t('models.subtitle')} />
      <div className="mb-6"><PhaseNotice phase={6} feature={t('models.title')} /></div>
      <Card>
        <CardHeader title={t('home.modelStatus')} />
        <CardBody>
          <div className="grid gap-x-8 sm:grid-cols-2" data-testid="capabilities-list">
            {CAPABILITY_IDS.map((id) => (
              <StatRow key={id} label={<span className="font-mono text-[12px]" dir="ltr">{id}</span>} value={<span title={capabilities?.[id]?.reasonKey ? t(capabilities[id].reasonKey, capabilities[id].reasonParams) : ''}><CapabilityBadge id={id} /></span>} />
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export function ExportScreen() {
  const { t, i18n } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const [exports, setExports] = useState<ExportInfo[]>([]);
  useEffect(() => {
    getApi().invoke('exports.list', { limit: 50 }).then(setExports).catch(reportError);
  }, [reportError]);
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('export.title')} subtitle={t('export.subtitle')} />
      <div className="mb-6"><PhaseNotice phase={7} feature={t('export.title')} /></div>
      <Card>
        <CardHeader title={t('export.history')} />
        <CardBody>
          {exports.length === 0 ? <EmptyState icon={<Download />} title={t('export.empty')} /> : (
            <ul className="divide-y divide-border" data-testid="exports-list">
              {exports.map((e) => <li key={e.id} className="flex items-center gap-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate font-mono text-[12px]" dir="ltr">{e.outputPath}</span><span className="text-muted">{e.status}</span><span className="text-muted">{formatBytes(e.sizeBytes, i18n.language)}</span><span className="text-faint">{formatDate(e.createdAt, i18n.language)}</span></li>)}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
