/**
 * Starts the API server and the Vite dev server together, so a single
 * `npm run dev` gives a working full stack.
 */

import { spawn } from 'node:child_process';

const children = [];

function run(name, command, args) {
  const child = spawn(command, args, { stdio: 'inherit', shell: false });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev] ${name} exited with code ${code}.`);
      shutdown(code);
    }
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] Starting API server and Vite dev server...');
run('api', 'npx', ['tsx', 'watch', 'server/dev-server.ts']);
run('web', 'npx', ['vite']);
