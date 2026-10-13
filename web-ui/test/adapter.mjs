// Verify the copied subagent adapter against this fork's real durable engine.
// Always uses the faux provider, even if real provider credentials are set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable';
import { Subagent } from '../../packages/coding-agent/src/experimental/durable/subagent.ts';

test('subagent returns its child answer through the fork output contract', { timeout: 10000 }, async () => {
  const context = BACKGROUND_CONTEXT;
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('subagent', { task: 'Name three prime numbers.' }, { id: 'call-1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('2, 3, and 5.')]),
    fauxAssistantMessage([fauxText('The child answered correctly.')]),
  ]);
  const registry = createRegistry();
  registry.install(Subagent);
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  try {
    const root = await harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' } } });
    harness.resume();
    const result = await (await root.submit({ type: 'input', content: 'Delegate the task.' }, context)).wait(context);
    assert.equal(result.status, 'done');
    const state = await root.viewState(context);
    try {
      const tool = state.value.entries.find(entry => entry.kind === 'pi.tool-result')?.model?.[0];
      assert.equal(tool?.role, 'toolResult');
      assert.equal(tool?.isError, false);
      assert.equal(tool?.content[0]?.text, '2, 3, and 5.');
      assert.equal(typeof tool?.details?.conversationId, 'number');
      const child = await harness.conversation(tool.details.conversationId, context);
      assert.ok(child);
    } finally { state.dispose(); }
  } finally { await harness.close(context); }
});
