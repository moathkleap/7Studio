import type { ApiHandlers } from '@sevenvid/ipc';
import type { Character, Script } from '@sevenvid/core';
import type { EngineServices } from './createEngine';

export type CreatorChannel =
  | 'creator.state' | 'creator.setBrief' | 'creator.updateScript'
  | 'creator.saveCharacter' | 'creator.removeCharacter' | 'creator.embedCharacter'
  | 'creator.storyboard' | 'creator.voice' | 'creator.assemble' | 'creator.review' | 'creator.clear';

/** Phase 5 handlers: the AI Video Creator (brief, script, characters, storyboard, voice, assembly, review). */
export function createCreatorHandlers(s: EngineServices): Pick<ApiHandlers, CreatorChannel> {
  return {
    'creator.state': ({ projectId }) => s.creator.state(projectId),
    'creator.setBrief': ({ projectId, brief }) => s.creator.setBrief(projectId, brief),
    'creator.updateScript': ({ projectId, script }) => s.creator.updateScript(projectId, script as Script),
    'creator.saveCharacter': ({ projectId, character }) => s.creator.saveCharacter(projectId, character as Character),
    'creator.removeCharacter': ({ projectId, characterId }) => s.creator.removeCharacter(projectId, characterId),
    'creator.embedCharacter': ({ projectId, characterId, imagePath }) => s.creator.embedCharacter(projectId, characterId, imagePath),
    'creator.storyboard': ({ projectId, sceneIds }) => s.creator.startStoryboard(projectId, sceneIds),
    'creator.voice': ({ projectId, sceneIds }) => s.creator.startVoice(projectId, sceneIds),
    'creator.assemble': ({ projectId }) => s.creator.startAssemble(projectId),
    'creator.review': ({ projectId }) => s.creator.review(projectId),
    'creator.clear': ({ projectId }) => s.creator.clear(projectId),
  };
}
