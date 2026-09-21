import { useTranslation } from 'react-i18next';
import { ExternalLink, FileText } from 'lucide-react';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import markUrl from '@/assets/brand/mark.png';

const REPO_URL = 'https://github.com/moathkleap/7vid';
const DOCS_URL = 'https://github.com/moathkleap/7vid/tree/HEAD/docs';

function openExternal(url: string): void {
  void getApi().invoke('shell.openExternal', { url }).catch(() => undefined);
}

/** Branded "About Seven Studios" panel: the mark, the SEVEN STUDIOS wordmark, build info and project links. */
export function AboutDialog() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.aboutOpen);
  const setOpen = useAppStore((s) => s.setAboutOpen);
  const info = useAppStore((s) => s.info);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('about.title')}
      size="sm"
      footer={<Button action="about.close" variant="ghost" onClick={() => setOpen(false)}>{t('common.close')}</Button>}
    >
      <div className="flex flex-col items-center text-center">
        <img src={markUrl} alt="" className="size-20 rounded-[18px] shadow-lg" />
        <div className="brand-wordmark mt-4 text-[26px] font-bold tracking-tight">SEVEN STUDIOS</div>
        <div className="mt-1 text-[13px] font-medium text-muted">{t('about.product')}</div>
        <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-muted">{t('about.tagline')}</p>
      </div>
      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-[12.5px]">
        <dt className="text-muted">{t('about.version')}</dt>
        <dd className="text-end font-medium">{info?.version ?? '—'}</dd>
        <dt className="text-muted">{t('about.platform')}</dt>
        <dd className="text-end font-medium">{info ? `${info.platform} · ${info.arch}` : '—'}</dd>
        {info?.electron ? (
          <>
            <dt className="text-muted">{t('about.electron')}</dt>
            <dd className="text-end font-medium">{info.electron}</dd>
          </>
        ) : null}
        <dt className="text-muted">{t('about.node')}</dt>
        <dd className="text-end font-medium">{info?.node ?? '—'}</dd>
      </dl>
      <div className="mt-4 flex justify-center gap-2">
        <Button action="about.github" size="sm" variant="secondary" icon={<ExternalLink />} onClick={() => openExternal(REPO_URL)}>
          {t('about.github')}
        </Button>
        <Button action="about.docs" size="sm" variant="secondary" icon={<FileText />} onClick={() => openExternal(DOCS_URL)}>
          {t('about.docs')}
        </Button>
      </div>
      <div className="mt-4 text-center text-[11px] text-faint">© {new Date().getFullYear()} {t('about.studio')} · {t('about.rights')}</div>
    </Dialog>
  );
}
