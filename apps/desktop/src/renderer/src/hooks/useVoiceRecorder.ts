import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'recording';

export interface Recording {
  /** base64-encoded audio bytes (no data-URL prefix) */
  base64: string;
  /** the recorder's container MIME type, e.g. `audio/webm;codecs=opus` */
  mimeType: string;
  /** wall-clock length of the recording, milliseconds */
  durationMs: number;
}

export class MicPermissionError extends Error {}

/** Picks a container the browser can actually record; falls back to the engine default. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Records a short microphone clip in the renderer and returns it as base64 for the engine to transcribe.
 * `getUserMedia` is denied for anything but the app's own local content by the main-process permission
 * handler, and the audio never leaves the machine — it is passed straight to the local speech worker.
 */
export function useVoiceRecorder(): {
  state: RecorderState;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => Promise<Recording | null>;
  cancel: () => void;
} {
  const [state, setState] = useState<RecorderState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  const teardown = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const start = useCallback(async () => {
    if (state === 'recording' || !supported) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') throw new MicPermissionError('Microphone access denied');
      throw err;
    }
    streamRef.current = stream;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start();
    setState('recording');
  }, [state, supported]);

  const stop = useCallback((): Promise<Recording | null> => {
    const recorder = recorderRef.current;
    if (!recorder || state !== 'recording') return Promise.resolve(null);
    const durationMs = Date.now() - startedAtRef.current;
    return new Promise<Recording | null>((resolve, reject) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || pickMimeType() || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        teardown();
        setState('idle');
        if (blob.size === 0) {
          resolve(null);
          return;
        }
        blobToBase64(blob).then(
          (base64) => resolve({ base64, mimeType: type, durationMs }),
          (err) => reject(err),
        );
      };
      try {
        recorder.stop();
      } catch (err) {
        teardown();
        setState('idle');
        reject(err);
      }
    });
  }, [state, teardown]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    teardown();
    setState('idle');
  }, [teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return { state, supported, start, stop, cancel };
}
