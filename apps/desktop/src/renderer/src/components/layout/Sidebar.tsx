import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Activity, Clapperboard, Download, FolderOpen, Home, Image, LayoutTemplate, Monitor, Settings, Share2, Sparkles, Brain } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/store/sessionStore';
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
  return (
    <nav className="flex h-full w-[212px] shrink-0 flex-col border-e border-border bg-surface" aria-label="main">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <img src={markUrl} alt="" className="size-8 shrink-0 rounded-lg shadow-sm" />
        <div className="flex min-w-0 flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">7vid</span>
          <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">Seven Studios</span>
        </div>
      </div>
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
