import { dbPath, defaultDataDir } from './paths.js';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  dbFile: string;
  webAutostart: boolean;
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(v.trim().toLowerCase());
}

export function loadConfig(
  overrides: Partial<Omit<Config, 'dbFile'>> = {},
  env = process.env,
): Config {
  const dataDir = overrides.dataDir ?? defaultDataDir(env);
  const port = overrides.port ?? Number(env.SHAKY_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${String(env.SHAKY_PORT ?? overrides.port)}`);
  }
  return {
    host: overrides.host ?? env.SHAKY_HOST ?? DEFAULT_HOST,
    port,
    dataDir,
    dbFile: dbPath(dataDir),
    webAutostart: overrides.webAutostart ?? parseBool(env.SHAKY_WEB_AUTOSTART, true),
  };
}
