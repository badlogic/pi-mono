/** Pure projection of the same durable documents used by Pi's TUI. */
export function textContent(content) {
  if (typeof content === 'string') return content;
  return (content || []).map(block => block.type === 'text' ? block.text : block.type === 'image' ? '[Image]' : '').join('');
}
export function statusOf(live = {}) {
  if (live.generation?.retry) return `Retrying (attempt ${live.generation.attempt + 1}): ${live.generation.retry.error}`;
  if (live.generation?.deferred) return 'Waiting for deferred response…';
  if (live.compactions?.length) return `Compacting (${live.compactions[0].reason})…`;
  const tool = live.tools?.find(slot => slot.status === 'running');
  if (tool) return `Running ${tool.name}…`;
  return live.run ? 'Working…' : 'Ready';
}
export function usageOf(view) {
  const usage = view.conversation.docs['pi.usage'] || {};
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const item of [...Object.values(usage.models || {}), ...Object.values(usage.tools || {})]) {
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) total[key] += item[key] || 0;
    total.cost += item.cost?.total || 0;
  }
  const entries = view.conversation.entries;
  const compacted = Math.max(0, ...entries.filter(e => e.kind === 'pi.compaction').map(e => e.id));
  const answer = [...entries].reverse().find(e => e.id >= compacted && e.kind === 'pi.assistant' && !['aborted', 'error'].includes(e.model?.[0]?.stopReason));
  const used = answer?.model?.[0]?.usage;
  total.context = used ? used.totalTokens || used.input + used.output + used.cacheRead + used.cacheWrite : undefined;
  return total;
}
export function transcriptOf(view) {
  const items = [];
  const calls = new Map();
  const addMessage = (message, key, streaming = false) => {
    if (message.role === 'toolResult') {
      const tool = calls.get(message.toolCallId);
      if (tool) Object.assign(tool, { output: textContent(message.content), status: message.isError ? 'error' : 'done', details: message.details });
      else items.push({ key, type: 'tool', name: message.toolName, status: message.isError ? 'error' : 'done', output: textContent(message.content) });
      return;
    }
    if (message.role === 'user') { items.push({ key, type: 'user', text: textContent(message.content) }); return; }
    if (message.role !== 'assistant') return;
    items.push({ key, type: 'assistant', text: textContent(message.content), thinking: (message.content || []).filter(b => b.type === 'thinking').map(b => b.thinking).join('\n'), streaming, error: message.errorMessage || (['error', 'aborted'].includes(message.stopReason) ? message.stopReason : '') });
    for (const block of message.content || []) {
      if (block.type !== 'toolCall') continue;
      const tool = { key: `${key}:${block.id}`, type: 'tool', name: block.name, args: block.arguments, status: streaming ? 'preparing' : message.stopReason === 'toolUse' ? 'pending' : 'not run' };
      calls.set(block.id, tool);
      items.push(tool);
    }
  };
  for (const entry of view.conversation.entries) {
    if (entry.kind === 'pi.compaction') items.push({ key: entry.id, type: 'compaction', text: textContent(entry.model?.[0]?.content) });
    else if (entry.kind === 'pi.reset') items.push({ key: entry.id, type: 'notice', text: 'New context' });
    else for (const [i, message] of (entry.model || []).entries()) addMessage(message, `${entry.id}:${i}`);
  }
  const live = view.conversation.docs['pi.live'] || {};
  if (live.generation?.message) addMessage(live.generation.message, 'streaming', true);
  for (const slot of live.tools || []) {
    let tool = calls.get(slot.callId);
    if (!tool && slot.status !== 'done') {
      tool = { key: `live:${slot.callId}`, type: 'tool', name: slot.name };
      items.push(tool);
    }
    if (!tool || (slot.status === 'done' && ['done', 'error'].includes(tool.status))) continue;
    Object.assign(tool, { status: slot.status, details: slot.details });
    if (slot.output !== undefined) tool.output = slot.output;
    if (slot.droppedBytes || slot.droppedLines) tool.truncated = 'Earlier tool output was truncated by the harness.';
  }
  return items;
}
