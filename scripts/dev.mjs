// Runs the API server (tsx watch) and the Vite dev server side by side.
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['--import', 'tsx', '--watch', 'src/cli.ts', 'serve'], {
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
