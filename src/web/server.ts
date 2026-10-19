import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Db } from '../db/connection.js';
import { VERSION } from '../version.js';
import { createApi } from './api.js';
import { ActivityWatcher, EventBus } from './events.js';
import { createMcpHttpHandler } from './mcpHttp.js';

export type Log = (msg: string) => void;

/** Built web client (dist/client), next to the compiled server code. */
const CLIENT_DIR = fileURLToPath(new URL('../client/', import.meta.url));

export interface AppOptions {
  host: string;
  port: number;
  clientDir?: string;
  pollMs?: number;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Shaky has no authentication, so only requests addressed to this machine are
 * served. Checking Host and Origin blocks DNS rebinding and cross-site writes
 * from other web pages open in the same browser.
 */
export function allowedHosts(host: string, port: number): Set<string> {
  const names = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (!LOOPBACK.has(host) && host !== '0.0.0.0' && host !== '::') names.add(host);
  return new Set([...names].flatMap((n) => [n, `${n}:${port}`]));
}

export function createApp(db: Db, opts: AppOptions) {
  const bus = new EventBus();
  const watcher = new ActivityWatcher(db, bus, opts.pollMs);
  const poke = () => watcher.poll();
  const mcp = createMcpHttpHandler(db, poke, `http://localhost:${opts.port}`);
  let hosts = allowedHosts(opts.host, opts.port);
  /** Called once listening, so port 0 (pick any) still gets a correct Host check. */
  const setPort = (port: number) => {
    hosts = allowedHosts(opts.host, port);
  };
  const app = new Hono();

  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    if (!hosts.has(host))
      return c.text(`Host ${host} is not allowed. Shaky only answers on localhost.`, 403);
    const origin = c.req.header('origin');
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        // invalid origin, rejected below
      }
      if (!hosts.has(originHost)) return c.text(`Origin ${origin} is not allowed.`, 403);
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.route('/api', createApi(db, { onWrite: poke }));

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let lastSent = watcher.lastId;
      const resumeFrom = Number(c.req.header('last-event-id'));
      if (Number.isInteger(resumeFrom) && resumeFrom > 0) {
        for (const a of watcher.since(resumeFrom)) {
          await stream.writeSSE({ event: 'change', id: String(a.id), data: JSON.stringify(a) });
          lastSent = a.id;
        }
      }
      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({ version: VERSION, last_id: watcher.lastId }),
      });
      const unsubscribe = bus.subscribe((e) => {
        if (e.id <= lastSent) return;
        lastSent = e.id;
        void stream.writeSSE({ event: e.type, id: String(e.id), data: JSON.stringify(e.activity) });
      });
      stream.onAbort(unsubscribe);
      while (!stream.aborted && !stream.closed) {
        await stream.sleep(20_000);
        if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: '' });
      }
      unsubscribe();
    }),
  );

  app.all('/mcp', mcp.handler);

  const clientDir = opts.clientDir ?? CLIENT_DIR;
  if (existsSync(`${clientDir}/index.html`)) {
    app.use('/*', serveStatic({ root: clientDir }));
    app.get('*', serveStatic({ root: clientDir, path: 'index.html' }));
  } else {
    app.get('/', (c) =>
      c.text(
        'Shaky is running, but the web UI is not built yet. Run "npm run build" (or "npm run dev").',
      ),
    );
  }

  return { app, bus, watcher, mcp, setPort };
}

export interface RunningWebServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Starts the HTTP server. Rejects with code EADDRINUSE when the port is taken. */
export function startWebServer(db: Db, opts: AppOptions, log: Log): Promise<RunningWebServer> {
  const { app, watcher, mcp, setPort } = createApp(db, opts);
  return new Promise((resolve, reject) => {
    let server: ServerType;
    const onError = (err: NodeJS.ErrnoException) => reject(err);
    // eslint-disable-next-line prefer-const
    server = serve(
      { fetch: app.fetch, hostname: opts.host, port: opts.port },
      (info: AddressInfo) => {
        server.off('error', onError);
        setPort(info.port);
        watcher.start();
        const shown = opts.host.includes(':') ? `[${opts.host}]` : opts.host;
        const url = `http://${shown === '127.0.0.1' ? 'localhost' : shown}:${info.port}`;
        log(`Web UI on ${url} (bound to ${opts.host}:${info.port}), MCP over HTTP at ${url}/mcp`);
        resolve({
          url,
          port: info.port,
          close: async () => {
            watcher.stop();
            await mcp.closeAll();
            await new Promise<void>((r) => {
              if ('closeAllConnections' in server) server.closeAllConnections();
              server.close(() => r());
            });
          },
        });
      },
    );
    server.once('error', onError);
  });
}
