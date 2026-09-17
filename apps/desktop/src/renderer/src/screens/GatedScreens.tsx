import { useTranslation } from 'react-i18next';
import { CAPABILITY_IDS } from '@sevenvid/core';
import { useAppStore } from '@/store/appStore';
import { CapabilityBadge, PhaseNotice } from '@/components/CapabilityGate';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader, StatRow } from '@/components/ui/Misc';

export function CreatorScreen() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title={t('creator.title')} subtitle={t('creator.subtitle')} />
      <PhaseNotice phase={5} feature={t('creator.title')} />
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
