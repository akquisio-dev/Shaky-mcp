import type { Db } from '../db/connection.js';
import { lastActivityId, listActivity, type Activity } from '../db/repos/misc.js';

/**
 * Server-to-browser event channel. Today it carries "change" events (one per
 * activity row); the mixing game (stage 2/3) will add its own event types on
 * the same bus, e.g. "training".
 */
export type ShakyEvent = { type: 'change'; id: number; activity: Activity };

type Listener = (e: ShakyEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  publish(e: ShakyEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // A broken subscriber must not stop the others.
      }
    }
  }
  get size(): number {
    return this.listeners.size;
  }
}

/**
 * Tails the activity table. This is how the web server learns about writes
 * from other processes, e.g. the stdio MCP server that Claude Desktop starts.
 */
export class ActivityWatcher {
  private timer: NodeJS.Timeout | undefined;
  private last: number;

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly intervalMs = 400,
  ) {
    this.last = lastActivityId(db);
  }

  get lastId(): number {
    return this.last;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Checks for new rows now. Returns how many were published. */
  poll(): number {
    let rows: Activity[];
    try {
      rows = listActivity(this.db, { afterId: this.last, limit: 500 });
    } catch {
      return 0; // database busy: try again on the next tick
    }
    for (const activity of rows) {
      this.last = activity.id;
      this.bus.publish({ type: 'change', id: activity.id, activity });
    }
    return rows.length;
  }

  /** Rows after a given id, for clients reconnecting with Last-Event-ID. */
  since(id: number): Activity[] {
    return listActivity(this.db, { afterId: id, limit: 200 });
  }
}
