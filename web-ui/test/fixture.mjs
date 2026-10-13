export function fixture() {
  const listeners = new Set();
  const calls = [];
  const state = {
    session: { id: 'test-session', cwd: '/workspace/example', directory: '/tmp/pi-test-session' },
    conversation: { conversation: { id: 1 }, entries: [], docs: { 'pi.agent': { model: { provider: 'test', modelId: 'faux' }, thinkingLevel: 'off' }, 'pi.live': {}, 'pi.inbox': { items: [] }, 'pi.usage': { models: {}, tools: {} } } },
    conversations: [{ id: 1, label: 'main' }, { id: 2, label: 'subagent 2', title: 'Inspect tests' }],
    models: [{ provider: 'test', modelId: 'faux', name: 'Faux test model', contextWindow: 10000 }],
    tasks: { tasks: {} }, notices: [],
  };
  const notify = () => listeners.forEach(fn => fn());
  const controller = Object.fromEntries(['submit', 'abort', 'compact', 'cycleThinking', 'setModel', 'toggleTasks', 'switchConversation'].map(name => [name, async (...args) => {
    calls.push([name, ...args]);
    if (name === 'switchConversation') state.conversation.conversation.id = args[0];
    if (name === 'cycleThinking') state.conversation.docs['pi.agent'].thinkingLevel = 'high';
    if (name === 'toggleTasks') state.tasks = state.tasks ? undefined : { tasks: {} };
    if (name === 'submit') {
      state.conversation.entries.push({ id: state.conversation.entries.length + 1, kind: 'pi.user', model: [{ role: 'user', content: args[0] }] });
    }
    notify();
  }]));
  return { state, calls, notify, view: { current: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } }, controller };
}
