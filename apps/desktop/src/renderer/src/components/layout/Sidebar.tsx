import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Activity, Clapperboard, Download, FolderOpen, Home, Image, LayoutTemplate, Monitor, Settings, Share2, Sparkles, Brain } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/store/sessionStore';
import { useAppStore } from '@/store/appStore';
import markUrl from '@/assets/brand/mark.png';

const items = [
  { to: '/', key: 'home', icon: Home, end: true },
  { to: '/editor', key: 'editor', icon: Clapperboard },
  { to: '/creator', key: 'creator', icon: Sparkles },
  { to: '/projects', key: 'projects', icon: FolderOpen },
  { to: '/media', key: 'media', icon: Image },
  { to: '/models', key: 'models', icon: Brain },
  { to: '/templates', key: 'templates', icon: LayoutTemplate },
  { to: '/export', key: 'export', icon: Download },
  { to: '/publish', key: 'publish', icon: Share2 },
  { to: '/settings', key: 'settings', icon: Settings },
  { to: '/system', key: 'system', icon: Monitor },
  { to: '/diagnostics', key: 'diagnostics', icon: Activity },
] as const;

export function Sidebar() {
  const { t } = useTranslation();
  const projectId = useSessionStore((s) => s.projectId);
  const setAboutOpen = useAppStore((s) => s.setAboutOpen);
  return (
    <nav className="flex h-full w-[212px] shrink-0 flex-col border-e border-border bg-surface" aria-label="main">
      <button
        type="button"
        data-action="about.open"
        onClick={() => setAboutOpen(true)}
        title={t('about.title')}
        className="focus-ring flex h-14 items-center gap-2.5 px-4 text-start transition-colors hover:bg-surface-2"
      >
        <img src={markUrl} alt="" className="size-8 shrink-0 rounded-lg shadow-sm" />
        <span className="brand-wordmark truncate text-[13px] font-bold uppercase tracking-[0.05em]">Seven Studios</span>
      </button>
      <div className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {items.map(({ to, key, icon: Icon, ...rest }) => {
          const target = (key === 'editor' || key === 'creator') && projectId ? `${to}/${projectId}` : to;
          return (
            <NavLink
              key={key}
              to={target}
              end={'end' in rest ? rest.end : false}
              data-action={`nav.${key}`}
              className={({ isActive }) => cn('focus-ring flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors', isActive ? 'bg-accent-soft text-text font-medium' : 'text-muted hover:bg-surface-2 hover:text-text')}
            >
              <Icon className="size-[18px] shrink-0" />
              <span className="truncate">{t(`nav.${key}`)}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
