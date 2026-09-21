import { describe, expect, it } from 'vitest';
import { estimateExportBytes, getExportPreset } from './presets';

const dims = { width: 1920, height: 1080, fps: 30 };

describe('estimateExportBytes', () => {
  it('is exact from the configured bitrate in bitrate mode', () => {
    const s = { ...getExportPreset('web-small').settings, qualityMode: 'bitrate' as const, videoBitrateKbps: 4000, audioBitrateKbps: 128 };
    const r = estimateExportBytes(10_000, s, dims);
    // (4000 + 128) kbps × 1000 / 8 bytes/s × 10 s × 1.1 overhead
    expect(r.videoBitrateKbps).toBe(4000);
    expect(r.estimatedBytes).toBe(Math.round(((4000 + 128) * 1000 / 8) * 10 * 1.1));
    expect(r.durationMs).toBe(10_000);
  });

  it('scales the CRF-mode estimate with resolution, fps and CRF', () => {
    const base = { ...getExportPreset('high-quality').settings, qualityMode: 'crf' as const, crf: 20, videoCodec: 'h264' as const };
    const small = estimateExportBytes(5000, base, { width: 640, height: 360, fps: 30 });
    const big = estimateExportBytes(5000, base, { width: 1920, height: 1080, fps: 30 });
    expect(big.estimatedBytes).toBeGreaterThan(small.estimatedBytes * 5); // ~9× the pixels
    const lowCrf = estimateExportBytes(5000, { ...base, crf: 14 }, dims);
    const highCrf = estimateExportBytes(5000, { ...base, crf: 28 }, dims);
    expect(lowCrf.estimatedBytes).toBeGreaterThan(highCrf.estimatedBytes); // lower CRF = bigger file
    const higherFps = estimateExportBytes(5000, base, { ...dims, fps: 60 });
    expect(higherFps.estimatedBytes).toBeGreaterThan(big.estimatedBytes);
  });

  it('accounts for codec efficiency: modern codecs estimate smaller than H.264', () => {
    const s = { ...getExportPreset('high-quality').settings, qualityMode: 'crf' as const, crf: 20 };
    const h264 = estimateExportBytes(5000, { ...s, videoCodec: 'h264' }, dims);
    const h265 = estimateExportBytes(5000, { ...s, videoCodec: 'h265' }, dims);
    const av1 = estimateExportBytes(5000, { ...s, videoCodec: 'av1' }, dims);
    expect(h265.estimatedBytes).toBeLessThan(h264.estimatedBytes);
    expect(av1.estimatedBytes).toBeLessThan(h265.estimatedBytes);
  });

  it('never returns a zero or negative estimate, even for a zero-length timeline', () => {
    const s = getExportPreset('youtube-1080p').settings;
    const r = estimateExportBytes(0, s, dims);
    expect(r.estimatedBytes).toBeGreaterThan(0);
    expect(r.videoBitrateKbps).toBeGreaterThan(0);
  });
});
