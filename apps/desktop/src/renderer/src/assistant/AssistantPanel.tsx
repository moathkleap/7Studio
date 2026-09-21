import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, ChevronRight, Loader2, Mic, Send, Sparkles, Square, Trash2, TriangleAlert, Undo2, X } from 'lucide-react';
import type { AssistantMessage, AssistantPlan, PlanRunResult, PlanStep, TaskInfo } from '@sevenstudios/ipc';
import { getApi, RemoteError } from '@/api/client';
import { useEvent } from '@/api/hooks';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Misc';
import { MicPermissionError, useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';
import { useSessionStore } from '@/store/sessionStore';

const EXAMPLES_AR = ['احذف أول 10 ثواني', 'طمس وجه الشخص على اليمين', 'حسّن الصوت وأضف ترجمة عربية', 'خليه مناسب للتيك توك'];
const EXAMPLES_EN = ['delete the first 10 seconds', 'blur the face on the right', 'clean up the audio', 'make it fit tiktok'];

/** Global AI assistant drawer: request → interpretation → plan → confirm → progress → verified report. */
export function AssistantPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en';
  const setOpen = useAppStore((s) => s.setAssistantOpen);
  const reportError = useAppStore((s) => s.reportError);
  const pushToast = useAppStore((s) => s.pushToast);
  const projectId = useSessionStore((s) => s.projectId);
  const selection = useEditorStore((s) => s.selection);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ value: number; message: string | null } | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useVoiceRecorder();
  const applyTaskRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      setMessages(await getApi().invoke('assistant.history', { projectId }));
    } catch (err) {
      reportError(err);
    }
  }, [projectId, reportError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, progress]);

  useEvent(
    'task.updated',
    useCallback(
      (task: TaskInfo) => {
        if (task.id !== applyTaskRef.current) return;
        if (task.status === 'running' || task.status === 'queued') setProgress({ value: task.progress, message: task.progressMessage });
        else if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
          applyTaskRef.current = null;
          setApplying(null);
          setProgress(null);
          void refresh();
        }
      },
      [refresh],
    ),
  );

  useEvent(
    'assistant.updated',
    useCallback(
      (e: { projectId: string; planId: string }) => {
        if (e.projectId !== projectId) return;
        applyTaskRef.current = null;
        setApplying(null);
        setProgress(null);
        void refresh();
      },
      [projectId, refresh],
    ),
  );

  const send = async (text: string) => {
    if (!projectId || !text.trim() || busy) return;
    setBusy(true);
    setInput('');
    try {
      await getApi().invoke('assistant.plan', { projectId, text: text.trim(), selectedClipIds: selection });
      await refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const notify = useCallback(
    (key: string, level: 'info' | 'warning' | 'error' = 'warning') => pushToast({ level, titleKey: key, messageKey: null, params: {}, errorId: null, taskId: null }),
    [pushToast],
  );

  // Voice request: record → transcribe locally → drop the text into the box and plan it automatically.
  const toggleVoice = async () => {
    if (!projectId || busy || transcribing) return;
    if (recorder.state === 'recording') {
      let clip;
      try {
        clip = await recorder.stop();
      } catch (err) {
        reportError(err);
        return;
      }
      if (!clip || clip.durationMs < 400) {
        notify('assistant.noSpeech');
        return;
      }
      setTranscribing(true);
      try {
        const lang = i18n.language.startsWith('ar') ? 'ar' : 'en';
        const { text } = await getApi().invoke('assistant.transcribe', { projectId, audioBase64: clip.base64, mimeType: clip.mimeType, language: lang });
        if (!text.trim()) {
          notify('assistant.noSpeech');
          return;
        }
        setInput(text);
        await send(text);
      } catch (err) {
        const code = err instanceof RemoteError ? err.info.code : null;
        if (code === 'NO_SPEECH_FOUND') notify('assistant.noSpeech');
        else if (code === 'MODEL_NOT_INSTALLED' || code === 'WORKER_UNAVAILABLE') notify('assistant.voiceUnavailable');
        else reportError(err);
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      await recorder.start();
    } catch (err) {
      if (err instanceof MicPermissionError) notify('assistant.micDenied', 'error');
      else reportError(err);
    }
  };

  const answer = async (plan: AssistantPlan, key: string, value: string | number | null) => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const choices: Record<string, string | number | null> = { [key]: value };
      await getApi().invoke('assistant.plan', { projectId, text: plan.text, selectedClipIds: selection, choices });
      await refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const applyPlan = async (plan: AssistantPlan) => {
    if (!projectId || applying) return;
    if (plan.meta === 'undo' || plan.meta === 'redo') {
      try {
        await getApi().invoke('assistant.meta', { projectId, action: plan.meta });
      } catch (err) {
        reportError(err);
      }
      return;
    }
    setApplying(plan.id);
    setProgress({ value: 0, message: null });
    try {
      const task = await getApi().invoke('assistant.apply', { projectId, planId: plan.id });
      applyTaskRef.current = task.id;
      if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
        applyTaskRef.current = null;
        setApplying(null);
        setProgress(null);
        await refresh();
      }
    } catch (err) {
      setApplying(null);
      setProgress(null);
      reportError(err);
    }
  };

  const clear = async () => {
    if (!projectId) return;
    try {
      await getApi().invoke('assistant.clear', { projectId });
      setMessages([]);
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-s border-border bg-surface animate-fade-in" data-testid="assistant-panel">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 text-accent" />
          {t('assistant.title')}
        </h2>
        <div className="flex items-center gap-1">
          {messages.length ? (
            <IconButton action="assistant.clear" label={t('assistant.clear')} size="sm" onClick={() => void clear()}>
              <Trash2 />
            </IconButton>
          ) : null}
          <IconButton action="assistant.close" label={t('common.close')} size="sm" onClick={() => setOpen(false)}>
            <X />
          </IconButton>
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4" data-testid="assistant-messages">
        {!projectId ? (
          <p className="text-[12.5px] text-muted">{t('assistant.openProject')}</p>
        ) : messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-[12.5px] text-muted">{t('assistant.intro')}</p>
            <div className="flex flex-wrap gap-2">
              {(lang === 'ar' ? EXAMPLES_AR : EXAMPLES_EN).map((ex) => (
                <button key={ex} data-action="assistant.example" className="focus-ring rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-muted hover:text-fg" onClick={() => void send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <MessageView key={m.id} message={m} lang={lang} busy={busy} applying={applying} progress={applying === m.plan?.id ? progress : null} onAnswer={answer} onApply={applyPlan} />)
        )}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        {recorder.state === 'recording' ? (
          <div className="mb-2 flex items-center gap-2 text-[12px] text-danger" data-testid="assistant-recording">
            <span className="inline-block size-2 animate-pulse rounded-full bg-danger" />
            {t('assistant.recording')}
          </div>
        ) : transcribing ? (
          <div className="mb-2 flex items-center gap-2 text-[12px] text-muted" data-testid="assistant-transcribing">
            <Spinner />
            {t('assistant.transcribing')}
          </div>
        ) : recorder.supported ? (
          <p className="mb-2 text-[11.5px] text-muted">{t('assistant.voiceHint')}</p>
        ) : null}
        <div className="flex items-end gap-2">
          {recorder.supported ? (
            <IconButton
              action="assistant.record"
              label={recorder.state === 'recording' ? t('assistant.stopRecording') : t('assistant.record')}
              size="md"
              disabled={!projectId || busy || transcribing}
              onClick={() => void toggleVoice()}
              className={recorder.state === 'recording' ? 'bg-danger/15 text-danger hover:bg-danger/20 hover:text-danger' : undefined}
              data-testid="assistant-record"
              data-recording={recorder.state === 'recording'}
            >
              {recorder.state === 'recording' ? <Square /> : <Mic />}
            </IconButton>
          ) : null}
          <textarea
            data-testid="assistant-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            disabled={!projectId || busy || transcribing}
            placeholder={t('assistant.placeholder')}
            className="focus-ring min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] outline-none disabled:opacity-50"
          />
          <Button action="assistant.send" variant="primary" icon={busy ? <Loader2 className="animate-spin" /> : <Send />} disabled={!projectId || busy || transcribing || !input.trim()} onClick={() => void send(input)} data-testid="assistant-send">
            {t('assistant.send')}
          </Button>
        </div>
      </form>
    </aside>
  );
}

function MessageView({
  message,
  lang,
  busy,
  applying,
  progress,
  onAnswer,
  onApply,
}: {
  message: AssistantMessage;
  lang: 'ar' | 'en';
  busy: boolean;
  applying: string | null;
  progress: { value: number; message: string | null } | null;
  onAnswer: (plan: AssistantPlan, key: string, value: string | number | null) => void;
  onApply: (plan: AssistantPlan) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="assistant-message" data-role="user">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 text-[13px]">{message.content}</div>
      </div>
    );
  }
  const plan = message.plan;
  const result = message.result;
  return (
    <div className="flex flex-col gap-2" data-testid="assistant-message" data-role="assistant">
      {plan ? <PlanCard plan={plan} result={result} lang={lang} busy={busy} applying={applying} progress={progress} onAnswer={onAnswer} onApply={onApply} /> : <div className="rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-[13px]">{message.content}</div>}
      {result ? <ResultCard result={result} lang={lang} /> : null}
    </div>
  );
}

function PlanCard({
  plan,
  result,
  lang,
  busy,
  applying,
  progress,
  onAnswer,
  onApply,
}: {
  plan: AssistantPlan;
  result: PlanRunResult | null;
  lang: 'ar' | 'en';
  busy: boolean;
  applying: string | null;
  progress: { value: number; message: string | null } | null;
  onAnswer: (plan: AssistantPlan, key: string, value: string | number | null) => void;
  onApply: (plan: AssistantPlan) => void;
}) {
  const { t } = useTranslation();
  const summary = lang === 'ar' ? plan.summaryAr : plan.summaryEn;
  const isApplying = applying === plan.id;
  const applied = plan.status === 'done' || plan.status === 'partial' || plan.status === 'failed' || result != null;

  if (plan.meta === 'help') {
    return (
      <div className="rounded-2xl rounded-bl-sm border border-border bg-surface-2 p-3 text-[13px]" data-testid="assistant-plan" data-meta="help">
        <p className="mb-2 flex items-center gap-2 font-medium"><Sparkles className="size-4 text-accent" />{t('assistant.help.title')}</p>
        <p className="text-[12.5px] text-muted">{t('assistant.help.body')}</p>
      </div>
    );
  }
  if (plan.meta === 'undo' || plan.meta === 'redo') {
    return (
      <div className="rounded-2xl rounded-bl-sm border border-border bg-surface-2 p-3" data-testid="assistant-plan" data-meta={plan.meta}>
        <p className="mb-2 text-[13px]">{t(`assistant.meta.${plan.meta}`)}</p>
        {!applied ? (
          <Button action={`assistant.meta.${plan.meta}`} size="sm" variant="primary" icon={<Undo2 />} onClick={() => onApply(plan)} data-testid="plan-apply">
            {t(`assistant.meta.${plan.meta}Do`)}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl rounded-bl-sm border border-border bg-surface-2 p-3" data-testid="assistant-plan" data-status={plan.status}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-medium"><Sparkles className="size-4 text-accent" />{summary}</span>
        {plan.confidence > 0 ? <span className="font-mono text-[10px] text-muted" dir="ltr">{Math.round(plan.confidence * 100)}%</span> : null}
      </div>

      {plan.steps.length === 0 && plan.unknownClauses.length > 0 ? <p className="text-[12.5px] text-warning">{t('assistant.notUnderstood')}</p> : null}

      <ol className="space-y-1.5">
        {plan.steps.map((step) => (
          <StepRow key={step.index} step={step} lang={lang} result={result} />
        ))}
      </ol>

      {plan.unknownClauses.length > 0 && plan.steps.length > 0 ? (
        <p className="mt-2 text-[11.5px] text-warning" data-testid="assistant-unknown">
          {t('assistant.someUnknown', { text: plan.unknownClauses.join('، ') })}
        </p>
      ) : null}

      {!applied && plan.clarifications.length > 0 ? (
        <div className="mt-3 space-y-2" data-testid="assistant-clarify">
          {plan.clarifications.map((q) => (
            <div key={`${q.operationIndex}:${q.field}`} className="rounded-lg bg-surface p-2">
              <p className="mb-1.5 text-[12px] text-muted">{t(q.questionKey, q.params as Record<string, unknown>)}</p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((o) => (
                  <button
                    key={String(o.value)}
                    data-action="assistant.clarify.option"
                    data-testid="clarify-option"
                    disabled={busy}
                    className="focus-ring rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] hover:border-accent disabled:opacity-50"
                    onClick={() => onAnswer(plan, `${q.operationIndex}:${q.field}`, o.value)}
                  >
                    {t(o.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {isApplying ? (
        <div className="mt-3" data-testid="assistant-progress">
          <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
            <Spinner />
            <span>{progress?.message ?? t('assistant.applying')}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round((progress?.value ?? 0) * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {!applied && !isApplying && plan.feasibleCount > 0 && plan.clarifications.length === 0 ? (
        <div className="mt-3 flex items-center gap-2">
          <Button action="assistant.apply" size="sm" variant="primary" icon={<Check />} disabled={busy} onClick={() => onApply(plan)} data-testid="plan-apply">
            {plan.requiresConfirmation ? t('assistant.apply') : t('assistant.applyNow')}
          </Button>
          {plan.feasibleCount < plan.steps.length ? <span className="text-[11.5px] text-muted">{t('assistant.someFeasible', { done: plan.feasibleCount, total: plan.steps.length })}</span> : null}
        </div>
      ) : null}

      {!applied && !isApplying && plan.feasibleCount === 0 && plan.steps.length > 0 ? <p className="mt-3 text-[12px] text-danger" data-testid="plan-blocked">{t('assistant.noneFeasible')}</p> : null}
    </div>
  );
}

function StepRow({ step, lang, result }: { step: PlanStep; lang: 'ar' | 'en'; result: PlanRunResult | null }) {
  const { t } = useTranslation();
  const summary = lang === 'ar' ? step.summaryAr : step.summaryEn;
  const outcome = result?.steps.find((s) => s.index === step.index);
  const reason = step.reasonKey ? t(step.reasonKey, { ...(step.reasonParams as Record<string, unknown>), status: step.capabilityStatus ? t(`capabilities.status.${step.capabilityStatus}`) : '' }) : null;
  return (
    <li className="flex items-start gap-2 text-[12.5px]" data-testid="plan-step" data-type={step.type} data-feasible={step.feasible} data-outcome={outcome?.status ?? ''}>
      <span className="mt-0.5 shrink-0">
        {outcome ? (
          outcome.status === 'done' ? (
            <Check className="size-3.5 text-success" />
          ) : outcome.status === 'failed' ? (
            <X className="size-3.5 text-danger" />
          ) : (
            <TriangleAlert className="size-3.5 text-warning" />
          )
        ) : step.feasible ? (
          <ChevronRight className="size-3.5 text-muted" />
        ) : (
          <TriangleAlert className="size-3.5 text-warning" />
        )}
      </span>
      <span className="flex-1">
        <span className={step.feasible ? '' : 'text-muted line-through'}>{summary}</span>
        {!step.feasible && reason ? <span className="block text-[11px] text-warning">{reason}</span> : null}
        {outcome?.detailEn ? <span className="block text-[11px] text-muted" dir="auto">{lang === 'ar' ? outcome.detailAr : outcome.detailEn}</span> : null}
        {outcome?.status === 'done' && outcome.verified === true ? <span className="ms-1 align-middle"><Badge tone="success">{t('assistant.verified')}</Badge></span> : null}
        {outcome?.status === 'done' && outcome.verified === false ? <span className="ms-1 align-middle"><Badge tone="warning">{t('assistant.unverified')}</Badge></span> : null}
      </span>
    </li>
  );
}

function ResultCard({ result, lang }: { result: PlanRunResult; lang: 'ar' | 'en' }) {
  const { t } = useTranslation();
  const tone = result.failedCount > 0 ? 'danger' : result.skippedCount > 0 ? 'warning' : 'success';
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-[12.5px]" data-testid="assistant-result" data-done={result.doneCount} data-failed={result.failedCount} data-skipped={result.skippedCount}>
      <div className="mb-1 flex items-center gap-2">
        <Badge tone={tone}>{t('assistant.report')}</Badge>
        <span className="text-[11px] text-muted">{t('assistant.counts', { done: result.doneCount, failed: result.failedCount, skipped: result.skippedCount })}</span>
      </div>
      <p className="whitespace-pre-line text-muted" data-testid="result-report" dir="auto">
        {lang === 'ar' ? result.reportAr : result.reportEn}
      </p>
    </div>
  );
}
