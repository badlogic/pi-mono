#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  console.error('Pi durable web requires Node.js 22.19 or newer.');
  process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node web-ui/start.mjs [--continue] [--cwd DIRECTORY] [--port NUMBER] [--no-open]\nStarts the real Pi durable harness and opens its local web UI. Default port: 4317; use 0 for a free port.');
  process.exit(0);
}
if (!existsSync(resolve(root, 'node_modules'))) {
  console.error('Pi dependencies are missing. First run: npm ci --ignore-scripts');
  process.exit(1);
}
if (!existsSync(resolve(root, 'packages/ai/src/providers/data/.manifest.json'))) {
  console.error('Pi model metadata is missing. First run: npm run hydrate:model-data');
  process.exit(1);
}
const child = spawn(process.execPath, [
  '--import', resolve(root, 'packages/coding-agent/src/experimental/source-resolver.ts'),
  resolve(root, 'web-ui/main.mjs'), ...args,
], { stdio: 'inherit', cwd: process.env.INIT_CWD || process.cwd() });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
