import type { Activity } from './api.js';

// Server events. Today: "change" (one per activity row). Stage 2/3 will add
// game events (e.g. a training loaded by the AI) on the same stream.

type Handlers = { change: (a: Activity) => void; status: (online: boolean) => void };

export function connectLive(h: Handlers): EventSource {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => h.status(true));
  es.addEventListener('change', (e) =>
    h.change(JSON.parse((e as MessageEvent<string>).data) as Activity),
  );
  es.onerror = () => h.status(false);
  es.onopen = () => h.status(true);
  return es;
}
