import { describe, expect, it } from 'vitest';
import { applyCommand, createAssetRef, createClip, createDocument } from '@sevenvid/core';
import { compileRenderGraph } from './RenderGraphCompiler';

function docWithAudioClip() {
  let doc = createDocument({ name: 'music', settings: { width: 1080, height: 1920, fps: { num: 30, den: 1 } } });
  const audio = createAssetRef({ id: 'ast_a', kind: 'audio', name: 'a.wav', sourcePath: '/tmp/a.wav', durationMs: 5000, width: null, height: null, fps: null, hasVideo: false, hasAudio: true });
  doc = applyCommand(doc, { type: 'asset.add', asset: audio }).doc;
  const a1 = doc.tracks.find((t) => t.kind === 'audio')!;
  doc = applyCommand(doc, { type: 'clip.insert', clip: createClip({ trackId: a1.id, asset: audio, startMs: 0, sourceInMs: 0, sourceOutMs: 5000, id: 'c1' }), mode: 'overwrite' }).doc;
  return doc;
}

const target = { width: 1080, height: 1920, fps: { num: 30, den: 1 }, sampleRate: 48000, channels: 2 };

describe('compileRenderGraph background music', () => {
  it('adds a looped music input and mixes it under the clip audio with the requested gain', () => {
    const graph = compileRenderGraph({ doc: docWithAudioClip(), target, backgroundMusic: { path: '/music/bed.mp3', gainDb: -6 } });
    const musicInput = graph.inputs.find((i) => i.path === '/music/bed.mp3');
    expect(musicInput).toBeTruthy();
    expect(musicInput!.args).toContain('-stream_loop');
    expect(graph.filterScript).toContain('[music]');
    expect(graph.filterScript).toContain('volume='); // -6 dB applied
    expect(graph.filterScript).toContain('amix=inputs=2'); // clip audio + music bed
  });

  it('produces no music branch when none is requested', () => {
    const graph = compileRenderGraph({ doc: docWithAudioClip(), target });
    expect(graph.inputs.some((i) => i.path === '/music/bed.mp3')).toBe(false);
    expect(graph.filterScript).not.toContain('[music]');
  });

  it('applies no volume filter to the music at 0 dB', () => {
    const graph = compileRenderGraph({ doc: docWithAudioClip(), target, backgroundMusic: { path: '/music/bed.mp3', gainDb: 0 } });
    const musicLine = graph.filterScript.split(';\n').find((l) => l.endsWith('[music]'))!;
    expect(musicLine).not.toContain('volume=');
  });

  it('mixes music even when the timeline has no audio (music becomes the only source)', () => {
    let doc = createDocument({ name: 'silent', settings: { width: 1080, height: 1920, fps: { num: 30, den: 1 } } });
    const image = createAssetRef({ id: 'ast_img', kind: 'image', name: 'img.png', sourcePath: '/tmp/img.png', durationMs: 5000, width: 1080, height: 1920, fps: null, hasVideo: true, hasAudio: false });
    doc = applyCommand(doc, { type: 'asset.add', asset: image }).doc;
    const v1 = doc.tracks.find((t) => t.kind === 'video')!;
    doc = applyCommand(doc, { type: 'clip.insert', clip: createClip({ trackId: v1.id, asset: image, startMs: 0, sourceInMs: 0, sourceOutMs: 5000, id: 'c1' }), mode: 'overwrite' }).doc;
    const graph = compileRenderGraph({ doc, target, backgroundMusic: { path: '/music/bed.mp3' } });
    expect(graph.inputs.some((i) => i.path === '/music/bed.mp3')).toBe(true);
    expect(graph.filterScript).toContain('[music]anull[amix]');
  });
});
