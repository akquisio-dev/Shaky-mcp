import { homedir } from 'node:os';
import { join } from 'node:path';

/** Per-user data directory, overridable with SHAKY_DATA_DIR. */
export function defaultDataDir(env = process.env, platform = process.platform): string {
  if (env.SHAKY_DATA_DIR) return env.SHAKY_DATA_DIR;
  const home = homedir();
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'shaky');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'shaky');
  return join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'shaky');
}

export function dbPath(dataDir: string): string {
  return join(dataDir, 'shaky.db');
}
