import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Db } from '../db/connection.js';
import { createMcpServer } from '../mcp/server.js';

const rpcError = (c: Context, status: 400 | 404, message: string) =>
  c.json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, status);

/**
 * Streamable HTTP endpoint at /mcp. One McpServer per session, because a
 * server instance can only be connected to one transport.
 */
export function createMcpHttpHandler(db: Db, onWrite?: () => void) {
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

  const handler = async (c: Context) => {
    const sid = c.req.header('mcp-session-id');
    if (sid) {
      const t = sessions.get(sid);
      if (!t) return rpcError(c, 404, 'Unknown or expired session.');
      const parsedBody =
        c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
      const res = await t.handleRequest(c.req.raw, { parsedBody });
      if (c.req.method === 'POST') onWrite?.();
      return res;
    }
    if (c.req.method !== 'POST') return rpcError(c, 400, 'Missing mcp-session-id header.');
    const body: unknown = await c.req.json().catch(() => undefined);
    if (!isInitializeRequest(body)) return rpcError(c, 400, 'First request must be initialize.');
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await createMcpServer(db).connect(transport);
    return transport.handleRequest(c.req.raw, { parsedBody: body });
  };

  const closeAll = async () => {
    await Promise.allSettled([...sessions.values()].map((t) => t.close()));
    sessions.clear();
  };

  return { handler, closeAll, sessions };
}
