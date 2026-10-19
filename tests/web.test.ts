import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp, startWebServer } from '../src/web/server.js';
import { openDb } from '../src/db/connection.js';
import { createCtx } from '../src/core/context.js';
import { setFillLevel } from '../src/core/inventory.js';
import { readSeedFile, seed } from '../src/core/seed.js';
import type { ShakyEvent } from '../src/web/events.js';
import { seededCtx } from './helpers.js';

const BASE = 'http://localhost:8787';
const app = () =>
  createApp(seededCtx().db, { host: '127.0.0.1', port: 8787, clientDir: '/nonexistent' });

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json', host: 'localhost:8787' },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

describe('REST API', () => {
  it('serves the overview and ingredient lists', async () => {
    const { app: a } = app();
    const o = await (await a.request(`${BASE}/api/overview`)).json();
    expect(o.makeable_now).toContain('Moscow Mule');
    const list = await (await a.request(`${BASE}/api/ingredients?location=fridge`)).json();
    expect(list.map((i: { name: string }) => i.name)).toContain('Lillet Blanc');
  });

  it('creates, changes and archives ingredients with source web', async () => {
    const { app: a } = app();
    const created = await a.request(
      `${BASE}/api/ingredients`,
      json('POST', { name: 'Monin Coconut', category: 'syrup', subcategory: 'monin' }),
    );
    expect(created.status).toBe(201);
    const { result } = await created.json();
    const fill = await a.request(
      `${BASE}/api/ingredients/${result.id}/fill-level`,
      json('POST', { fill_level: 'quarter' }),
    );
    expect((await fill.json()).result.fill_level).toBe('quarter');
    await a.request(`${BASE}/api/ingredients/${result.id}/archive`, json('POST', {}));
    const acts = await (await a.request(`${BASE}/api/activity?limit=3`)).json();
    expect(acts.map((x: { source: string }) => x.source)).toEqual(['web', 'web', 'web']);
  });

  it('maps errors to status codes', async () => {
    const { app: a } = app();
    expect((await a.request(`${BASE}/api/ingredients/9999`)).status).toBe(404);
    const bad = await a.request(`${BASE}/api/ingredients`, json('POST', { name: '' }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toContain('name');
  });

  it('logs a mix and returns makeable recipes', async () => {
    const { app: a } = app();
    const mk = await (await a.request(`${BASE}/api/makeable`)).json();
    const mule = mk.makeable.find((r: { name: string }) => r.name === 'Moscow Mule');
    const res = await a.request(`${BASE}/api/mix`, json('POST', { recipe: mule.recipe_id }));
    expect(res.status).toBe(201);
    expect((await res.json()).result.deducted.length).toBe(3);
  });

  it('rejects foreign hosts and origins', async () => {
    const { app: a } = app();
    expect((await a.request('http://evil.example/api/overview')).status).toBe(403);
    const cross = await a.request(`${BASE}/api/ingredients`, {
      method: 'POST',
      headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(cross.status).toBe(403);
    const ok = await a.request(`${BASE}/api/health`, {
      headers: { origin: 'http://localhost:8787' },
    });
    expect(ok.status).toBe(200);
  });
});

describe('live updates across processes', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('publishes a change written by another connection (like the stdio MCP process)', () => {
    dir = mkdtempSync(join(tmpdir(), 'shaky-'));
    const file = join(dir, 'shaky.db');
    const webDb = openDb(file);
    const mcpDb = openDb(file);
    seed(createCtx(mcpDb, 'cli'), readSeedFile());
    const { bus, watcher } = createApp(webDb, { host: '127.0.0.1', port: 8787, clientDir: '/x' });
    watcher.poll();
    const seen: ShakyEvent[] = [];
    bus.subscribe((e) => seen.push(e));

    setFillLevel(createCtx(mcpDb, 'mcp'), 'Lillet Blanc', 'quarter');
    expect(watcher.poll()).toBe(1);
    expect(seen[0]?.activity).toMatchObject({ source: 'mcp', entity: 'ingredient' });
    expect(seen[0]?.activity.summary).toContain('Lillet Blanc');
    webDb.close();
    mcpDb.close();
  });
});

describe('HTTP server', () => {
  it('serves MCP over Streamable HTTP and pushes SSE events', async () => {
    const db = seededCtx().db;
    const web = await startWebServer(
      db,
      { host: '127.0.0.1', port: 0, clientDir: '/x', pollMs: 50 },
      () => {},
    );
    try {
      const base = `http://127.0.0.1:${web.port}`;
      const ctrl = new AbortController();
      const sse = await fetch(`${base}/api/events`, { signal: ctrl.signal });
      expect(sse.headers.get('content-type')).toContain('text/event-stream');
      const reader = sse.body!.getReader();

      const client = new Client({ name: 'http-test', version: '0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      const r = await client.callTool({
        name: 'set_fill_level',
        arguments: { ingredient: 'Vodka', fill_level: 'quarter' },
      });
      expect(r.isError).toBeFalsy();
      await client.close();

      let text = '';
      const decoder = new TextDecoder();
      const deadline = Date.now() + 3000;
      while (!text.includes('event: change') && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      ctrl.abort();
      expect(text).toContain('event: hello');
      expect(text).toContain('event: change');
      expect(text).toContain('Vodka');
    } finally {
      await web.close();
    }
  });
});

describe('static web client', () => {
  it('serves files from an absolute client dir with SPA fallback', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'shaky-client-'));
    try {
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Shaky</title>');
      writeFileSync(join(dir, 'assets', 'a.js'), 'console.log(1)');
      const { app: a } = createApp(seededCtx().db, {
        host: '127.0.0.1',
        port: 8787,
        clientDir: dir,
      });
      const index = await a.request(`${BASE}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain('<title>Shaky</title>');
      expect((await a.request(`${BASE}/assets/a.js`)).status).toBe(200);
      const fallback = await a.request(`${BASE}/recipes`);
      expect(fallback.status).toBe(200);
      expect(await fallback.text()).toContain('Shaky');
      expect((await a.request(`${BASE}/api/health`)).headers.get('content-type')).toContain('json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('logs settings changes with source web', async () => {
    const { app: a } = app();
    const r = await a.request(`${BASE}/api/settings`, json('PATCH', { language: 'de' }));
    expect((await r.json()).language).toBe('de');
    const [last] = await (await a.request(`${BASE}/api/activity?limit=1`)).json();
    expect(last).toMatchObject({ source: 'web', entity: 'settings' });
  });
});
