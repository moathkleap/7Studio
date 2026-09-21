import { FileAudio, FileImage, FileVideo } from 'lucide-react';
import type { AssetInfo } from '@sevenstudios/ipc';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Thumbnail (or a type icon when none exists) for a media asset. Lives in its own module so both the Media
 * library screen and the editor's media panel can use it without pulling one screen's chunk into the other's.
 */
export function AssetThumb({ asset, className }: { asset: AssetInfo; className?: string }) {
  const url = useMediaUrl(asset.thumbnailPath);
  const Icon = asset.kind === 'image' ? FileImage : asset.kind === 'audio' || asset.kind === 'music' || asset.kind === 'voice' ? FileAudio : FileVideo;
  return (
    <div className={cn('relative grid aspect-video w-full place-items-center overflow-hidden rounded-lg bg-surface-3', className)}>
      {url ? <img src={url} alt="" className="size-full object-cover" draggable={false} /> : <Icon className="size-8 text-faint" />}
      {asset.durationMs != null ? <span className="absolute bottom-1.5 end-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white" dir="ltr">{formatDuration(asset.durationMs)}</span> : null}
      {asset.missing ? <span className="absolute inset-0 grid place-items-center bg-danger/30 text-[12px] font-medium text-white">{'missing'}</span> : null}
    </div>
  );
}
