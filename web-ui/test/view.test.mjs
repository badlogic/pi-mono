import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptOf, statusOf, usageOf } from '../public/view.js';
import { fixture } from './fixture.mjs';

test('tool results correlate to repeated call IDs in their own turn; partials and failures survive', () => {
  const { state } = fixture();
  state.conversation.entries = [
    { id: 1, kind: 'pi.assistant', model: [{ role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'same', name: 'bash', arguments: { command: 'one' } }] }] },
    { id: 2, kind: 'pi.tool-result', model: [{ role: 'toolResult', toolCallId: 'same', toolName: 'bash', isError: true, content: [{ type: 'text', text: 'failed one' }] }] },
    { id: 3, kind: 'pi.assistant', model: [{ role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'same', name: 'bash', arguments: { command: 'two' } }] }] },
  ];
  state.conversation.docs['pi.live'] = { tools: [{ callId: 'same', name: 'bash', status: 'running', output: 'partial two' }] };
  const tools = transcriptOf(state).filter(i => i.type === 'tool');
  assert.equal(tools.length, 2);
  assert.equal(tools[0].status, 'error'); assert.equal(tools[0].output, 'failed one');
  assert.equal(tools[1].status, 'running'); assert.equal(tools[1].output, 'partial two');
  state.conversation.docs['pi.live'] = { generation: { message: { role: 'assistant', content: [{ type: 'text', text: '<script>unsafe</script>' }] } } };
  assert.equal(transcriptOf(state).at(-1).text, '<script>unsafe</script>');
  assert.equal(transcriptOf(state).at(-1).streaming, true);
});

test('status and usage follow durable documents, including compaction boundaries', () => {
  assert.match(statusOf({ generation: { attempt: 1, retry: { error: 'limited' } } }), /attempt 2/);
  assert.equal(statusOf({ tools: [{ name: 'read', status: 'running' }] }), 'Running read…');
  assert.equal(statusOf(), 'Ready');
  const { state } = fixture();
  state.conversation.docs['pi.usage'].models.test = { input: 10, output: 3, cacheRead: 2, cost: { total: .05 } };
  state.conversation.entries = [{ id: 1, kind: 'pi.assistant', model: [{ role: 'assistant', stopReason: 'stop', usage: { totalTokens: 15 } }] }, { id: 2, kind: 'pi.compaction', model: [] }];
  assert.equal(usageOf(state).cost, .05);
  assert.equal(usageOf(state).context, undefined);
});
