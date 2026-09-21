import { useEffect } from 'react';
import type { EventName, EventPayload } from '@sevenstudios/ipc';
import { getApi } from './client';

export function useEvent<E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): void {
  useEffect(() => getApi().subscribe(event, handler), [event, handler]);
}
