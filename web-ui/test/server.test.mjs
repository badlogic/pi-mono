import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { get } from 'node:http';
import { startServer } from '../server.mjs';
import { fixture } from './fixture.mjs';

test('authenticated transport, streaming state, durable actions and replay protection', async t => {
  const durable = fixture();
  const web = await startServer(durable, { port: 0 });
  t.after(() => web.close());
  const headers = { Authorization: `Bearer ${web.token}`, 'Content-Type': 'application/json' };
  const post = (command, extra = {}) => fetch(`${web.origin}/api/command`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(command) });
  const command = (action, fields = {}) => ({ action, requestId: randomUUID(), conversationId: durable.state.conversation.conversation.id, ...fields });
  assert.equal((await fetch(`${web.origin}/api/events`)).status, 401);
  assert.equal((await fetch(`${web.origin}/api/events`, { headers: { Authorization: `Bearer ${web.token}`, Origin: 'https://attacker.example' } })).status, 403);
  const badHost = await new Promise((resolve, reject) => {
    get(`${web.origin}/api/events`, { headers: { ...headers, Host: 'attacker.example' } }, res => {
      res.resume(); resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.equal(badHost, 403);
  assert.equal((await fetch(`${web.origin}/../server.mjs`)).status, 404);
  const home = await fetch(web.origin);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await home.text(), /DURABLE SESSION/);
  const stream = await fetch(`${web.origin}/api/events`, { headers });
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /test-session/);
  const input = command('submit', { text: 'Hello', whenBusy: 'steer' });
  const results = await Promise.all([post(input), post(input)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.deepEqual(durable.calls, [['submit', 'Hello', 'steer']]);
  assert.match(new TextDecoder().decode((await reader.read()).value), /Hello/);
  assert.equal((await post({ ...input, text: 'Changed' })).status, 409);
  assert.equal((await post(command('submit', { text: '', whenBusy: 'steer' }))).status, 400);
  assert.equal((await post(command('submit', { text: 'x', whenBusy: 'bad' }))).status, 400);
  assert.equal((await post(command('submit', { text: 'x'.repeat(270000), whenBusy: 'steer' }))).status, 413);
  assert.equal((await post(command('model', { provider: 'bad', modelId: 'bad' }))).status, 400);
  assert.equal((await post(command('model', { provider: 'test', modelId: 'faux' }))).status, 200);
  for (const action of ['thinking', 'tasks', 'compact', 'abort']) assert.equal((await post(command(action))).status, 200);
  assert.equal((await post(command('conversation', { id: 2 }))).status, 200);
  assert.equal((await post({ ...command('submit', { text: 'stale', whenBusy: 'steer' }), conversationId: 1 })).status, 409);
  assert.equal((await post(command('submit', { text: 'later', whenBusy: 'followUp' }))).status, 200);
  assert.equal((await post(command('arbitrary'))).status, 400);
  await reader.cancel();
});
