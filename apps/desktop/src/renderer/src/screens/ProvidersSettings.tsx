import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, HardDrive, ShieldCheck } from 'lucide-react';
import type { AppSettings, DeepPartial } from '@sevenstudios/core';
import type { ProviderStatusInfo } from '@sevenstudios/ipc';
import { getApi } from '@/api/client';
import { useEvent } from '@/api/hooks';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Input, Switch } from '@/components/ui/Input';
import { useAppStore } from '@/store/appStore';

/** Settings → External Providers: enable and configure cloud/local AI providers, with a real connection test. */
export function ProvidersSettings({ settings, update }: { settings: AppSettings; update: (patch: DeepPartial<AppSettings>) => Promise<void> }) {
  const { t } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const [providers, setProviders] = useState<ProviderStatusInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      setProviders(await getApi().invoke('providers.list'));
    } catch (err) {
      reportError(err);
    }
  }, [reportError]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  useEvent('providers.changed', useCallback(() => void refresh(), [refresh]));

  const external = settings.privacy.allowExternalProviders;

  return (
    <div className="space-y-4 py-4" data-testid="providers-settings">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-4">
        <ShieldCheck className="mt-0.5 size-5 text-accent" />
        <div className="flex-1">
          <p className="text-[13px] font-medium">{t('providers.consentTitle')}</p>
          <p className="text-[12.5px] text-muted">{t('providers.consentBody')}</p>
        </div>
        <Switch action="providers.allowExternal" checked={external} onCheckedChange={(v) => void update({ privacy: { allowExternalProviders: v } })} />
      </div>

      {providers.map((p) => (
        <ProviderCard key={p.id} provider={p} externalAllowed={external} onSaved={refresh} />
      ))}
    </div>
  );
}

function ProviderCard({ provider, externalAllowed, onSaved }: { provider: ProviderStatusInfo; externalAllowed: boolean; onSaved: () => void }) {
  const { t } = useTranslation();
  const reportError = useAppStore((s) => s.reportError);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [model, setModel] = useState(provider.model);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    // only seed the fields when switching to a different provider — never clobber what the user is typing on refresh
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseUrl(provider.baseUrl);
    setModel(provider.model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id]);

  const save = async (patch: { enabled?: boolean }) => {
    setBusy(true);
    const sentSecret = secret;
    try {
      await getApi().invoke('providers.setConfig', { providerId: provider.id, baseUrl, model, ...(sentSecret ? { secret: sentSecret } : {}), ...patch });
      // only clear the field when this save actually carried a secret, so a background toggle-save never wipes typed input
      if (sentSecret) setSecret('');
      onSaved();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await getApi().invoke('providers.test', { providerId: provider.id }));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="provider-card" data-provider={provider.id} data-configured={provider.configured}>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {provider.external ? <Cloud className="size-4 text-warning" /> : <HardDrive className="size-4 text-accent" />}
            <span className="font-medium">{provider.name}</span>
            {provider.external ? <Badge tone="warning">{t('providers.external')}</Badge> : <Badge tone="neutral">{t('providers.local')}</Badge>}
            {provider.configured ? <Badge tone="success">{t('providers.ready')}</Badge> : null}
          </div>
          <Switch action="providers.enable" checked={provider.enabled} disabled={provider.external && !externalAllowed} onCheckedChange={(v) => void save({ enabled: v })} />
        </div>
        {provider.external && !externalAllowed ? <p className="text-[12px] text-warning">{t('providers.enableExternalFirst')}</p> : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t('providers.baseUrl')}><Input value={baseUrl} data-testid="provider-baseurl" onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider.defaultBaseUrl} dir="ltr" /></Field>
          <Field label={t('providers.model')}><Input value={model} data-testid="provider-model" onChange={(e) => setModel(e.target.value)} placeholder={provider.defaultModel} dir="ltr" /></Field>
          {provider.needsSecret ? (
            <Field label={t('providers.apiKey')} hint={provider.hasSecret ? (provider.secretEncrypted ? t('providers.keyStoredEncrypted') : t('providers.keyStoredPlain')) : undefined}>
              <Input type="password" value={secret} data-testid="provider-secret" onChange={(e) => setSecret(e.target.value)} placeholder={provider.hasSecret ? '••••••••' : t('providers.apiKeyPlaceholder')} dir="ltr" />
            </Field>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button action="providers.save" size="sm" variant="primary" loading={busy} onClick={() => void save({})} data-testid="provider-save">{t('common.save')}</Button>
          <Button action="providers.test" size="sm" variant="outline" loading={busy} disabled={!provider.configured} onClick={() => void runTest()} data-testid="provider-test">{t('providers.test')}</Button>
          {test ? <span className={`text-[12px] ${test.ok ? 'text-success' : 'text-danger'}`} data-testid="provider-test-result" data-ok={test.ok}>{test.ok ? t('providers.testOk', { message: test.message }) : test.message}</span> : null}
        </div>
      </CardBody>
    </Card>
  );
}
