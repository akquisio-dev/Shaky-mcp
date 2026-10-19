#!/usr/bin/env node
import { accessSync, constants, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type Config } from './config.js';
import { createCtx } from './core/context.js';
import { readSeedFile, seed } from './core/seed.js';
import { exportBar, importBar } from './core/backup.js';
import {
  exportIngredientsCsv,
  exportRecipesCsv,
  importIngredientsCsv,
  importRecipesCsv,
  parseCsv,
} from './core/csv.js';
import { removeExampleData } from './core/examples.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { openDb } from './db/connection.js';
import { getSetting } from './db/repos/misc.js';
import { createMcpServer } from './mcp/server.js';
import { VERSION } from './version.js';
import { startWebServer, type RunningWebServer } from './web/server.js';

const HELP = `Shaky ${VERSION}, your local AI bartender

Usage: shaky <command> [options]

Commands:
  serve     Web UI + REST API + MCP over Streamable HTTP at /mcp
  mcp       MCP over stdio (what Claude Desktop runs). Also starts the web UI
            when the port is free, unless --no-web or SHAKY_WEB_AUTOSTART=false
  seed      Load the example bar from examples/seed.json (--reset wipes first,
            --remove takes the example data out again)
  export    Write the whole bar as JSON to a file (or stdout without a path);
            --csv ingredients|recipes writes a spreadsheet instead
  import    Load a JSON export (merge by name, --replace wipes first) or a
            CSV of ingredients or recipes; --dry-run only shows the result
  doctor    Check the setup and print a Claude Desktop config snippet

Options:
  --host <addr>       Interface to bind (default 127.0.0.1, env SHAKY_HOST)
  --port <n>          Port (default 8787, env SHAKY_PORT)
  --data-dir <path>   Where shaky.db lives (env SHAKY_DATA_DIR)
  --no-web            mcp: never start the web UI
  --reset             seed: delete all bar data before loading
  --replace           import: delete all bar data before loading
  --file <path>       seed: load another seed file
  -h, --help          Show this help
  -v, --version       Show the version
`;

/** stderr only: in stdio mode, stdout belongs to the MCP protocol. */
const log = (msg: string) => process.stderr.write(`[shaky] ${msg}\n`);

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      'no-web': { type: 'boolean' },
      reset: { type: 'boolean' },
      remove: { type: 'boolean' },
      replace: { type: 'boolean' },
      csv: { type: 'string' },
      'dry-run': { type: 'boolean' },
      file: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
}

function configFrom(values: ReturnType<typeof parse>['values']): Config {
  return loadConfig({
    host: values.host,
    port: values.port !== undefined ? Number(values.port) : undefined,
    dataDir: values['data-dir'],
    webAutostart: values['no-web'] ? false : undefined,
  });
}

function warnIfExposed(host: string) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    log(
      `WARNING: bound to ${host}. Shaky has no authentication; anyone who can reach this address can change your bar.`,
    );
  }
}

function onShutdown(fn: () => Promise<void> | void) {
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    Promise.resolve(fn()).finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return stop;
}

async function cmdServe(cfg: Config) {
  warnIfExposed(cfg.host);
  const db = openDb(cfg.dbFile);
  log(`Database: ${cfg.dbFile}`);
  let web: RunningWebServer;
  try {
    web = await startWebServer(db, { host: cfg.host, port: cfg.port }, log);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EADDRINUSE') {
      log(
        `Port ${cfg.port} on ${cfg.host} is already in use. Is Shaky already running? Try --port.`,
      );
      process.exit(1);
    }
    throw e;
  }
  onShutdown(async () => {
    await web.close();
    db.close();
  });
}

async function cmdMcp(cfg: Config) {
  const db = openDb(cfg.dbFile);
  const server = createMcpServer(db, { webUrl: `http://localhost:${cfg.port}` });
  const transport = new StdioServerTransport();
  let web: RunningWebServer | undefined;

  const shutdown = onShutdown(async () => {
    await web?.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    db.close();
  });
  // Claude Desktop closes stdin when it quits; take the web UI down with us.
  process.stdin.on('end', shutdown);
  transport.onclose = shutdown;

  await server.connect(transport);
  log(`MCP on stdio, database ${cfg.dbFile}`);

  const autostart = cfg.webAutostart && getSetting<boolean>(db, 'web_autostart', true);
  if (!autostart) return;
  try {
    warnIfExposed(cfg.host);
    web = await startWebServer(db, { host: cfg.host, port: cfg.port }, log);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EADDRINUSE') {
      log(
        `Port ${cfg.port} is busy (probably "shaky serve" is running); MCP only. Changes still show up there.`,
      );
    } else {
      log(`Web UI did not start: ${err.message}. MCP keeps running.`);
    }
  }
}

function cmdSeed(cfg: Config, values: ReturnType<typeof parse>['values']) {
  const db = openDb(cfg.dbFile);
  if (values.remove) {
    const { result } = removeExampleData(createCtx(db, 'cli'));
    db.close();
    console.log(
      `Removed ${result.total} example item(s) from ${cfg.dbFile}. Your own items were kept.`,
    );
    return;
  }
  const file = values.file ? readSeedFile(values.file) : readSeedFile();
  const { result } = seed(createCtx(db, 'cli'), file, {
    reset: values.reset,
    // Files shipped in examples/ count as example data and can be removed later.
    origin: !values.file || /[\\/]examples[\\/]/.test(values.file) ? 'example' : undefined,
  });
  db.close();
  console.log(
    `${values.reset ? 'Reset and loaded' : 'Loaded'} into ${cfg.dbFile}: ${Object.entries(result)
      .map(([k, v]) => `${v} ${k.replace('_', ' ')}`)
      .join(', ')} (existing items were kept).`,
  );
}

function cmdExport(cfg: Config, file: string | undefined, csv?: string) {
  const db = openDb(cfg.dbFile);
  const ctx = createCtx(db, 'cli');
  const json = csv
    ? `\uFEFF${csv === 'recipes' ? exportRecipesCsv(ctx) : exportIngredientsCsv(ctx)}`
    : JSON.stringify(exportBar(ctx), null, 2);
  db.close();
  if (!file) return void process.stdout.write(`${json}\n`);
  writeFileSync(file, `${json}\n`);
  console.log(`Exported to ${file}`);
}

function cmdImport(cfg: Config, file: string | undefined, replace: boolean, dryRun = false) {
  if (!file) throw new Error('Usage: shaky import <file.json|file.csv> [--replace] [--dry-run]');
  const db = openDb(cfg.dbFile);
  if (/\.csv$/i.test(file)) {
    const text = readFileSync(file, 'utf8');
    const ctx = { ...createCtx(db, 'cli'), dryRun };
    const isRecipes = 'recipe' in (parseCsv(text)[0] ?? {});
    const r = isRecipes ? importRecipesCsv(ctx, text) : importIngredientsCsv(ctx, text);
    db.close();
    console.log(`${dryRun ? 'Dry run, nothing saved: ' : ''}${JSON.stringify(r.result)}`);
    return;
  }
  const { result } = importBar(
    createCtx(db, 'cli'),
    JSON.parse(readFileSync(file, 'utf8')),
    replace ? 'replace' : 'merge',
  );
  db.close();
  console.log(
    `${replace ? 'Replaced the bar with' : 'Merged'} ${file}: ${Object.entries(result)
      .map(([k, v]) => `${v} ${k.replace('_', ' ')}`)
      .join(', ')}${replace ? '' : ' (items with existing names were kept)'}.`,
  );
}

function portFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

function claudeConfigPath(): string {
  if (process.platform === 'win32') return '%APPDATA%\\Claude\\claude_desktop_config.json';
  if (process.platform === 'darwin')
    return join(homedir(), 'Library/Application Support/Claude/claude_desktop_config.json');
  return join(homedir(), '.config/Claude/claude_desktop_config.json');
}

async function cmdDoctor(cfg: Config) {
  let problems = 0;
  const line = (ok: boolean, text: string) => {
    if (!ok) problems++;
    console.log(`${ok ? ' ok ' : 'FAIL'}  ${text}`);
  };
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  line(
    major > 22 || (major === 22 && minor >= 12),
    `Node.js ${process.versions.node} (need 22.12 or newer)`,
  );
  console.log(`      platform ${process.platform}/${process.arch}`);

  try {
    const db = openDb(cfg.dbFile);
    const n = (
      db.prepare('SELECT COUNT(*) AS n FROM ingredients WHERE archived = 0').get() as { n: number }
    ).n;
    db.close();
    accessSync(cfg.dbFile, constants.W_OK);
    line(
      true,
      `Database ${cfg.dbFile} (${n} ingredients${n === 0 ? ', run "shaky seed" for example data' : ''})`,
    );
  } catch (e) {
    line(false, `Database ${cfg.dbFile}: ${(e as Error).message}`);
  }

  const free = await portFree(cfg.host, cfg.port);
  console.log(
    `${free ? ' ok ' : 'info'}  Port ${cfg.host}:${cfg.port} ${free ? 'is free' : 'is in use (fine if Shaky is already running)'}`,
  );
  const uiBuilt = existsSync(fileURLToPath(new URL('./client/index.html', import.meta.url)));
  line(uiBuilt, `Web UI ${uiBuilt ? 'is built' : 'is not built, run "npm run build"'}`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(cfg.host)) {
    line(false, `Host ${cfg.host} is not loopback. Shaky has no authentication.`);
  }

  const cliPath = fileURLToPath(import.meta.url);
  const snippet = {
    mcpServers: {
      shaky: {
        command: process.execPath,
        args: [cliPath, 'mcp'],
        ...(process.env.SHAKY_DATA_DIR && { env: { SHAKY_DATA_DIR: process.env.SHAKY_DATA_DIR } }),
      },
    },
  };
  console.log(`\nClaude Desktop config (${claudeConfigPath()}):\n`);
  console.log(JSON.stringify(snippet, null, 2));
  console.log('\nMerge "shaky" into an existing "mcpServers" block, then restart Claude Desktop.');
  console.log(`Web UI after starting: http://localhost:${cfg.port}`);
  if (problems) process.exitCode = 1;
}

async function main() {
  const { values, positionals } = parse(process.argv.slice(2));
  if (values.version) return console.log(VERSION);
  const cmd = positionals[0];
  if (values.help || !cmd || cmd === 'help') return console.log(HELP);
  const cfg = configFrom(values);
  switch (cmd) {
    case 'serve':
      return cmdServe(cfg);
    case 'mcp':
      return cmdMcp(cfg);
    case 'seed':
      return cmdSeed(cfg, values);
    case 'export':
      return cmdExport(cfg, positionals[1], values.csv);
    case 'import':
      return cmdImport(cfg, positionals[1], Boolean(values.replace), Boolean(values['dry-run']));
    case 'doctor':
      return cmdDoctor(cfg);
    default:
      console.error(`Unknown command "${cmd}".\n\n${HELP}`);
      process.exitCode = 2;
  }
}

main().catch((e: unknown) => {
  log(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
