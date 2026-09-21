import type { ApiHandlers } from '@sevenstudios/ipc';
import type { EngineServices } from './createEngine';

export type AssistantChannel = 'assistant.plan' | 'assistant.apply' | 'assistant.history' | 'assistant.clear' | 'assistant.meta';

/** Phase 4 handlers: the AI assistant (plan, apply, history, undo/redo). */
export function createAssistantHandlers(s: EngineServices): Pick<ApiHandlers, AssistantChannel> {
  return {
    'assistant.plan': ({ projectId, text, selectedClipIds, choices }) => s.assistant.plan(projectId, text, { selectedClipIds, choices }),
    'assistant.apply': ({ projectId, planId, selectedClipIds }) => s.assistant.apply(projectId, planId, selectedClipIds ?? []),
    'assistant.history': ({ projectId }) => s.assistant.history(projectId),
    'assistant.clear': ({ projectId }) => s.assistant.clear(projectId),
    'assistant.meta': ({ projectId, action }) => s.assistant.meta(projectId, action),
  };
}
