// Real Chromium checks using its built-in DevTools protocol; no browser-test dependency.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';
import { fixture } from './fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.artifacts/web-ui/output`;
const profile = `${root}.artifacts/web-ui/temp/web-ui-chrome-${Date.now()}`;
await mkdir(out, { recursive: true });
await mkdir(profile, { recursive: true });
const durable = fixture();
const server = await startServer(durable, { port: 0 });
const chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) {
  for (let i = 0; i < 100; i++) { try { const value = await fn(); if (value) return value; } catch {} await pause(100); }
  throw new Error(`Timed out: ${message}`);
}
const results = [];
try {
  const port = await until(async () => (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n')[0], 'Chrome startup');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const requests = new Map();
  const exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const entry = requests.get(message.id); if (!entry) return; clearTimeout(entry.timer); requests.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    requests.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const viewport = (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await viewport(1440, 1000);
  await cdp('Page.navigate', { url: server.url });
  await until(() => evaluate("document.getElementById('connection')?.textContent === 'Connected'"), 'UI connection');
  await cdp('Page.captureScreenshot', { format: 'png' }).then(result => writeFile(`${out}/desktop-empty.png`, Buffer.from(result.data, 'base64')));
  for (const [width, height] of [[1440, 1000], [1024, 768], [768, 650], [600, 700]]) {
    await viewport(width, height); await pause(120);
    const dimensions = await evaluate('({width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight})');
    assert.ok(dimensions.scrollWidth <= width, JSON.stringify(dimensions));
    assert.ok(dimensions.scrollHeight <= height, JSON.stringify(dimensions));
    results.push({ test: 'viewport without page overflow', ...dimensions });
  }
  await viewport(390, 500); await pause(150);
  const tiny = await evaluate('({width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight})');
  assert.ok(tiny.scrollHeight > tiny.height); assert.ok(tiny.scrollWidth <= tiny.width); results.push({ test: 'tiny viewport vertical fallback', ...tiny });
  await evaluate("document.getElementById('activity').click()");
  await until(() => evaluate("document.getElementById('activity-dialog').open"), 'mobile task access');
  await evaluate("document.getElementById('activity-dialog').close()");
  await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }).then(result => writeFile(`${out}/mobile.png`, Buffer.from(result.data, 'base64')));
  await viewport(1440, 1000);
  await evaluate("document.getElementById('prompt').value = '<img src=x onerror=alert(1)> test'; document.getElementById('send').click()");
  await until(() => durable.calls.some(c => c[0] === 'submit'), 'submit forwarding');
  await until(() => evaluate("document.getElementById('transcript').textContent.includes('<img src=x')"), 'safe prompt rendering');
  assert.equal(await evaluate("document.querySelectorAll('#transcript img').length"), 0);
  await evaluate("document.getElementById('thinking').click()");
  await until(() => evaluate("document.getElementById('thinking').textContent.includes('high')"), 'thinking');
  await evaluate("document.getElementById('model').click()");
  assert.equal(await evaluate("document.getElementById('model-dialog').open"), true);
  await evaluate("document.querySelector('#models button').click()");
  await until(() => evaluate("!document.getElementById('model-dialog').open"), 'model selection');
  await evaluate("document.getElementById('agents').click(); [...document.querySelectorAll('dialog[open] .model-list button')].at(-1).click()");
  await until(() => evaluate("document.getElementById('conversation-title').textContent === 'subagent 2'"), 'conversation switch');
  await evaluate("document.getElementById('prompt').value = 'next'; document.getElementById('follow-up').click()");
  await until(() => durable.calls.some(c => c[0] === 'submit' && c[2] === 'followUp'), 'follow-up');
  durable.state.conversation.docs['pi.live'] = { run: { taskId: 7 }, generation: { attempt: 0, message: { role: 'assistant', content: [{ type: 'text', text: '## Inspecting the project\nI found a small durable runtime with a clean presentation boundary.\n\n```js\nconst session = await openDurable();\n```' }, { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'src/main.ts' } }] } }, tools: [{ callId: 'c1', name: 'read', status: 'running', output: 'export async function main() {\n  await session.start();\n}' }] };
  durable.state.tasks = { tasks: { 7: { id: 7, kind: 'pi.generation', conversationId: 2, state: { status: 'running', phase: 'tools' }, conversations: [] } } };
  durable.notify();
  await until(() => evaluate("document.querySelector('.tool-card') !== null"), 'streaming tool card');
  await evaluate("document.getElementById('expand').click()");
  assert.equal(await evaluate("document.querySelector('.tool-card').open"), true);
  await cdp('Page.captureScreenshot', { format: 'png' }).then(result => writeFile(`${out}/desktop-active.png`, Buffer.from(result.data, 'base64')));
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => durable.calls.some(c => c[0] === 'abort'), 'escape abort');
  await evaluate("document.getElementById('compact').click(); document.getElementById('compact-instructions').value = 'Keep decisions'; document.querySelector('#compact-form button[type=submit]').click()");
  await until(() => durable.calls.some(c => c[0] === 'compact' && c[1] === 'Keep decisions'), 'compaction');
  await cdp('Page.reload');
  await until(() => evaluate("document.getElementById('connection')?.textContent === 'Connected' && document.querySelector('.tool-card')"), 'reload reconnect');
  assert.equal(durable.calls.filter(c => c[0] === 'submit').length, 2, 'reload must not replay prompts');
  assert.deepEqual(exceptions, []);
  results.push({ test: 'browser controls, safe rendering, streaming, reload without replay', status: 'pass' });
  await writeFile(`${out}/browser-results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  socket?.close(); chrome.kill('SIGTERM'); await server.close();
}
