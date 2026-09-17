import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDocument } from '@sevenvid/core';
import { useEditorStore } from '@/store/editorStore';
import { useMediaStore } from '@/store/mediaStore';
import { Badge } from '@/components/ui/Badge';
import { activeCues, audibleClips, cssFilterFor, fitRect, visibleLayers } from './compositor';

interface PoolEntry {
  el: HTMLVideoElement | HTMLImageElement | HTMLAudioElement;
  assetId: string;
  path: string;
  kind: 'video' | 'image' | 'audio';
  ready: boolean;
  error: boolean;
  lastSeekAt: number;
}

const WINDOW_MS = 4000;

/**
 * Live preview: composites the clips visible at the playhead onto a canvas from real media elements
 * (proxies when available), plays their audio with the clip/track gains, and draws active subtitles.
 * Effects that FFmpeg renders exactly are approximated here and labeled as such.
 */
export function PreviewPlayer({ doc }: { doc: ProjectDocument }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  const poolRef = useRef(new Map<string, PoolEntry>());
  const renderedRef = useRef<HTMLVideoElement | null>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const [unplayable, setUnplayable] = useState<string[]>([]);
  const previewMode = useEditorStore((s) => s.previewMode);
  const renderedPreview = useEditorStore((s) => s.renderedPreview);
  const hasEffects = doc.tracks.some((t) => t.clips.some((c) => c.effects.length > 0 || c.reverse));
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const aspect = docRef.current.settings.width / docRef.current.settings.height;
      let w = rect.width;
      let h = w / aspect;
      if (h > rect.height) {
        h = rect.height;
        w = h * aspect;
      }
      setSize({ w: Math.max(64, Math.floor(w)), h: Math.max(36, Math.floor(h)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.settings.width, doc.settings.height]);

  useEffect(() => {
    if (!renderedPreview) {
      renderedRef.current?.pause();
      renderedRef.current = null;
      return;
    }
    const v = document.createElement('video');
    v.src = renderedPreview.url;
    v.preload = 'auto';
    v.muted = false;
    renderedRef.current = v;
    return () => {
      v.pause();
      v.removeAttribute('src');
    };
  }, [renderedPreview]);

  useEffect(() => {
    const pool = poolRef.current;
    let raf = 0;
    let disposed = false;
    const urlFor = useMediaStore.getState().urlFor;

    const dispose = (entry: PoolEntry) => {
      if (entry.el instanceof HTMLMediaElement) {
        entry.el.pause();
        entry.el.removeAttribute('src');
        entry.el.load();
      }
    };
    const ensure = (clipId: string, assetId: string, kind: PoolEntry['kind'], path: string): PoolEntry => {
      let entry = pool.get(clipId);
      if (entry && entry.path === path) return entry;
      if (entry) {
        dispose(entry);
        pool.delete(clipId);
      }
      const el = kind === 'image' ? new Image() : kind === 'audio' ? document.createElement('audio') : document.createElement('video');
      entry = { el, assetId, path, kind, ready: false, error: false, lastSeekAt: 0 };
      if (!(el instanceof HTMLImageElement)) {
        el.preload = 'auto';
        el.crossOrigin = 'anonymous';
        (el as HTMLVideoElement).playsInline = true;
        el.addEventListener('loadeddata', () => {
          entry!.ready = true;
          useEditorStore.getState().markUnplayable(assetId, false);
          setUnplayable((u) => u.filter((id) => id !== assetId));
        });
        el.addEventListener('error', () => {
          entry!.error = true;
          useEditorStore.getState().markUnplayable(assetId, true);
          setUnplayable((u) => (u.includes(assetId) ? u : [...u, assetId]));
        });
      } else {
        el.addEventListener('load', () => (entry!.ready = true));
        el.addEventListener('error', () => (entry!.error = true));
      }
      pool.set(clipId, entry);
      void urlFor(path).then((url) => {
        if (disposed || !url) return;
        el.src = url;
      });
      return entry;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const state = useEditorStore.getState();
      const d = docRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const tMs = state.playheadMs;

      if (state.previewMode === 'rendered' && state.renderedPreview && renderedRef.current) {
        const v = renderedRef.current;
        const local = (tMs - state.renderedPreview.startMs) / 1000;
        if (local >= 0 && tMs <= state.renderedPreview.endMs) {
          if (state.playing) {
            if (v.paused) void v.play().catch(() => undefined);
            if (Math.abs(v.currentTime - local) > 0.15) v.currentTime = local;
          } else {
            if (!v.paused) v.pause();
            if (Math.abs(v.currentTime - local) > 0.03 && !v.seeking) v.currentTime = local;
          }
          if (v.readyState >= 2) ctx.drawImage(v, 0, 0, W, H);
        } else if (!v.paused) v.pause();
        for (const [, e] of pool) if (e.el instanceof HTMLMediaElement && !e.el.paused) e.el.pause();
        return;
      }
      if (renderedRef.current && !renderedRef.current.paused) renderedRef.current.pause();

      const active = new Set<string>();
      const near = (startMs: number, endMs: number) => endMs >= tMs - WINDOW_MS && startMs <= tMs + WINDOW_MS;
      for (const track of d.tracks) {
        for (const clip of track.clips) {
          if (!near(clip.startMs, clip.startMs + clip.durationMs)) continue;
          const asset = d.assets[clip.assetId];
          if (!asset) continue;
          const kind: PoolEntry['kind'] = asset.kind === 'image' ? 'image' : asset.hasVideo ? 'video' : 'audio';
          ensure(clip.id, asset.id, kind, asset.proxyPath ?? asset.sourcePath);
          active.add(clip.id);
        }
      }
      for (const [clipId, entry] of pool) {
        if (!active.has(clipId)) {
          dispose(entry);
          pool.delete(clipId);
        }
      }

      const audible = new Map(audibleClips(d, tMs).map((a) => [a.clip.id, a]));
      const layers = visibleLayers(d, tMs);
      const usedMedia = new Set<string>();
      const syncMedia = (entry: PoolEntry, sourceMs: number, clipSpeed: number, reverse: boolean, gain: number | null) => {
        const el = entry.el as HTMLMediaElement;
        usedMedia.add(el === entry.el ? entry.assetId + entry.lastSeekAt : '');
        const wantRate = clipSpeed * state.rate;
        const canPlay = state.playing && !reverse && wantRate >= 0.25 && wantRate <= 4;
        el.muted = gain === null;
        el.volume = gain === null ? 0 : gain;
        if (canPlay) {
          if (el.playbackRate !== wantRate) el.playbackRate = wantRate;
          const drift = Math.abs(el.currentTime * 1000 - sourceMs);
          if (drift > 180 && !el.seeking) el.currentTime = sourceMs / 1000;
          if (el.paused && el.readyState >= 2) void el.play().catch(() => undefined);
        } else {
          if (!el.paused) el.pause();
          const now = performance.now();
          if (Math.abs(el.currentTime * 1000 - sourceMs) > 25 && !el.seeking && now - entry.lastSeekAt > 16) {
            entry.lastSeekAt = now;
            el.currentTime = sourceMs / 1000;
          }
        }
      };

      for (const layer of layers) {
        const entry = pool.get(layer.clip.id);
        if (!entry || entry.error) continue;
        const a = audible.get(layer.clip.id);
        if (entry.el instanceof HTMLMediaElement) syncMedia(entry, layer.sourceMs, layer.clip.speed, layer.clip.reverse, a ? a.gain : null);
        const el = entry.el;
        const ready = el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : el.readyState >= 2;
        if (!ready) continue;
        const sw = el instanceof HTMLVideoElement ? el.videoWidth : el instanceof HTMLImageElement ? el.naturalWidth : 0;
        const sh = el instanceof HTMLVideoElement ? el.videoHeight : el instanceof HTMLImageElement ? el.naturalHeight : 0;
        if (!sw || !sh) continue;
        const tr = layer.clip.transform;
        const cropX = tr.cropLeft * sw;
        const cropY = tr.cropTop * sh;
        const cropW = Math.max(1, sw * (1 - tr.cropLeft - tr.cropRight));
        const cropH = Math.max(1, sh * (1 - tr.cropTop - tr.cropBottom));
        const rot = ((Math.round(tr.rotate) % 360) + 360) % 360;
        const swapped = rot === 90 || rot === 270;
        const rect = fitRect(layer.clip, swapped ? cropH : cropW, swapped ? cropW : cropH, W, H);
        ctx.save();
        ctx.globalAlpha = tr.opacity;
        const filter = cssFilterFor(layer.clip);
        if (tr.fit === 'blur-fill') {
          ctx.save();
          ctx.filter = 'blur(18px)';
          const r = Math.max(W / cropW, H / cropH);
          ctx.drawImage(el as CanvasImageSource, cropX, cropY, cropW, cropH, (W - cropW * r) / 2, (H - cropH * r) / 2, cropW * r, cropH * r);
          ctx.restore();
        }
        if (filter) ctx.filter = filter;
        ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
        if (rot) ctx.rotate((rot * Math.PI) / 180);
        ctx.scale(tr.flipH ? -1 : 1, tr.flipV ? -1 : 1);
        const dw = swapped ? rect.h : rect.w;
        const dh = swapped ? rect.w : rect.h;
        ctx.drawImage(el as CanvasImageSource, cropX, cropY, cropW, cropH, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }

      for (const [clipId, a] of audible) {
        if (layers.some((l) => l.clip.id === clipId)) continue;
        const entry = pool.get(clipId);
        if (!entry || entry.error || !(entry.el instanceof HTMLMediaElement)) continue;
        syncMedia(entry, a.sourceMs, a.clip.speed, a.clip.reverse, a.gain);
      }
      for (const [clipId, entry] of pool) {
        if (!(entry.el instanceof HTMLMediaElement)) continue;
        if (!layers.some((l) => l.clip.id === clipId) && !audible.has(clipId) && !entry.el.paused) entry.el.pause();
      }

      const cues = activeCues(d.subtitles, tMs);
      for (const { track, text } of cues) {
        const st = track.style;
        const scale = H / 1080;
        const fontPx = Math.max(10, st.fontSize * scale);
        ctx.save();
        ctx.font = `${st.bold ? '700' : '400'} ${fontPx}px "${st.fontFamily}", "IBM Plex Sans Arabic", "Noto Sans Arabic", "Inter", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.direction = /[؀-ۿ]/.test(text) ? 'rtl' : 'ltr';
        const lines = wrap(ctx, text, W * 0.9);
        const lineH = fontPx * 1.25;
        const marginV = st.marginV * scale;
        let y = st.position === 'top' ? marginV + fontPx : st.position === 'center' ? H / 2 - ((lines.length - 1) * lineH) / 2 + fontPx / 3 : H - marginV - (lines.length - 1) * lineH;
        for (const line of lines) {
          if (st.backgroundColor) {
            const m = ctx.measureText(line);
            ctx.fillStyle = st.backgroundColor;
            ctx.globalAlpha = 0.6;
            ctx.fillRect(W / 2 - m.width / 2 - 8, y - fontPx, m.width + 16, lineH);
            ctx.globalAlpha = 1;
          }
          ctx.lineWidth = Math.max(1, st.outlineWidth * scale * 2);
          ctx.strokeStyle = st.outlineColor;
          ctx.lineJoin = 'round';
          if (st.outlineWidth > 0) ctx.strokeText(line, W / 2, y);
          ctx.fillStyle = st.color;
          ctx.fillText(line, W / 2, y);
          y += lineH;
        }
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const [, e] of pool) {
        if (e.el instanceof HTMLMediaElement) {
          e.el.pause();
          e.el.removeAttribute('src');
        }
      }
      pool.clear();
    };
  }, []);

  const badge = previewMode === 'rendered' && renderedPreview ? t('editor.previewRendered') : hasEffects ? t('editor.previewApprox') : t('editor.previewLive');
  const unplayableNames = unplayable.map((id) => doc.assets[id]?.name).filter(Boolean);
  return (
    <div ref={containerRef} className="relative grid h-full w-full place-items-center overflow-hidden bg-black" data-testid="preview">
      <canvas ref={canvasRef} width={size.w * (window.devicePixelRatio || 1)} height={size.h * (window.devicePixelRatio || 1)} style={{ width: size.w, height: size.h }} />
      <div className="pointer-events-none absolute start-3 top-3 flex flex-col gap-1">
        <Badge tone={previewMode === 'rendered' ? 'success' : hasEffects ? 'warning' : 'neutral'} dot>{badge}</Badge>
        {unplayableNames.length ? <Badge tone="warning">{t('editor.previewUnplayable')} ({unplayableNames.join(', ')})</Badge> : null}
      </div>
    </div>
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}
