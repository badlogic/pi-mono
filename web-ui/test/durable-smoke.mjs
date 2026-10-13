// Exercise the real CLI, SQLite persistence and resume without a model request.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const profile = `${root}.artifacts/web-ui/temp/durable-web-smoke-${Date.now()}`;
await mkdir(profile, { recursive: true });
await mkdir(`${root}.artifacts/web-ui/output`, { recursive: true });
const logs = [];
async function launch(continuing) {
  const args = [`${root}web-ui/start.mjs`, '--no-open', '--port', '0', '--cwd', profile];
  if (continuing) args.push('--continue');
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: `${profile}/agent` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Startup timeout: ${output}`)); }, 20000);
    const receive = data => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+/);
      if (match) { clearTimeout(timeout); resolve(new URL(match[0])); }
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Early exit ${code}: ${output}`)); });
  });
  try {
    const token = new URLSearchParams(url.hash.slice(1)).get('token');
    const response = await fetch(`${url.origin}/api/events`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    const state = JSON.parse(text.split('\n\n')[0].slice(6));
    await reader.cancel();
    assert.equal(state.session.cwd, profile);
    assert.ok(state.conversation.docs['pi.agent']);
    assert.ok(state.tasks);
    return { id: state.session.id, directory: state.session.directory, conversationId: state.conversation.conversation.id };
  } finally {
    child.kill('SIGTERM');
    let timeout;
    const result = await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Shutdown timeout')); }, 15000); })]);
    clearTimeout(timeout);
    assert.equal(result.code, 0);
    logs.push(output.replace(/#token=[a-f0-9]+/g, '#token=[redacted]'));
  }
}
try {
  const first = await launch(false);
  const resumed = await launch(true);
  assert.deepEqual(resumed, first);
  console.log(JSON.stringify({ status: 'pass', checks: ['real durable runtime startup', 'authenticated state stream', 'graceful shutdown and lock release', 'same SQLite session resumed with --continue'], session: first, modelRequests: 0 }, null, 2));
} finally { await writeFile(`${root}.artifacts/web-ui/output/durable-process.log`, logs.join('\n')); }
