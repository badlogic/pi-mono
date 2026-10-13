import { textContent, statusOf, usageOf, transcriptOf } from './view.js';

const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get('token') || sessionStorage.getItem('pi-web-token');
if (fragment.has('token')) { sessionStorage.setItem('pi-web-token', token); history.replaceState(null, '', location.pathname); }
let view, online = false, pending = false, expanded = false, lastTranscript = '', lastNavigation = '';
let localError = '', selectedConversation;
const drafts = new Map();
const opened = new Map();
const transcript = $('transcript');
const welcome = transcript.firstElementChild;
const prompt = $('prompt');
let following = true;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
// Markdown is rendered using DOM text nodes only; model/tool HTML is never executed.
function inline(parent, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(end, match.index)));
    const part = match[0];
    if (part.startsWith('`')) parent.append(el('code', part.slice(1, -1)));
    else if (part.startsWith('**')) parent.append(el('strong', part.slice(2, -2)));
    else {
      const split = part.indexOf('](');
      const a = el('a', part.slice(1, split));
      a.href = part.slice(split + 2, -1); a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a);
    }
    end = match.index + part.length;
  }
  parent.append(document.createTextNode(text.slice(end)));
}
function prose(text) {
  const node = el('div', undefined, 'prose');
  let code, paragraph;
  for (const line of String(text || '').split('\n')) {
    if (/^\s*```/.test(line)) {
      if (code) code = undefined;
      else { code = el('pre'); node.append(code); }
      paragraph = undefined; continue;
    }
    if (code) { code.append(document.createTextNode(`${line}\n`)); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { const h = el(`h${Math.min(4, heading[1].length + 1)}`); inline(h, heading[2]); node.append(h); paragraph = undefined; }
    else if (!line) paragraph = undefined;
    else {
      if (!paragraph) { paragraph = el('p'); node.append(paragraph); }
      else paragraph.append(document.createTextNode('\n'));
      inline(paragraph, line);
    }
  }
  return node;
}
function detail(key, title, contents, className) {
  const node = el('details', undefined, className);
  node.open = opened.get(key) ?? expanded;
  const summary = el('summary');
  summary.append(title);
  node.append(summary, contents);
  node.addEventListener('toggle', () => { if (node.isConnected) opened.set(key, node.open); });
  return node;
}
function renderTranscript() {
  const items = transcriptOf(view);
  const signature = JSON.stringify([view.conversation.conversation.id, items]);
  if (signature === lastTranscript) return;
  lastTranscript = signature;
  const scroll = transcript.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    if (item.type === 'tool') {
      const title = el('span'); title.append(el('strong', item.name), el('span', item.status, 'tool-state'));
      const body = el('div', undefined, 'tool-body');
      if (item.args !== undefined) body.append(el('pre', JSON.stringify(item.args, null, 2)));
      if (item.output) body.append(el('pre', item.output));
      if (item.truncated) body.append(el('p', item.truncated, 'muted'));
      if (item.details?.conversationId !== undefined) {
        const button = el('button', `Open subagent ${item.details.conversationId}`);
        button.onclick = () => run('conversation', { id: item.details.conversationId });
        body.append(button);
      }
      fragment.append(detail(item.key, title, body, `tool-card ${item.status === 'error' ? 'error' : ''}`));
    } else if (item.type === 'compaction') fragment.append(detail(item.key, el('span', 'Context summary'), prose(item.text), 'thinking-card'));
    else {
      const message = el('article', undefined, `message ${item.type}`);
      message.append(el('header', item.type === 'user' ? 'You' : item.type === 'assistant' ? `Pi${item.streaming ? ' · streaming' : ''}` : 'Context'));
      if (item.thinking) message.append(detail(`${item.key}:thinking`, el('span', 'Reasoning'), prose(item.thinking), 'thinking-card'));
      if (item.text) message.append(item.type === 'user' ? el('div', item.text, 'prose') : prose(item.text));
      if (item.error) message.append(el('p', item.error, 'danger'));
      fragment.append(message);
    }
  }
  transcript.replaceChildren(items.length ? fragment : welcome);
  transcript.scrollTop = following ? transcript.scrollHeight : scroll;
}
function renderNavigation() {
  const signature = JSON.stringify([view.conversations, view.conversation.conversation.id, view.tasks]);
  if (signature === lastNavigation) return;
  lastNavigation = signature;
  const nav = $('conversations'); nav.replaceChildren();
  for (const conversation of view.conversations) {
    const active = conversation.id === view.conversation.conversation.id;
    const button = el('button', conversation.label, active ? 'active' : '');
    button.setAttribute('aria-current', active ? 'true' : 'false');
    if (conversation.title) button.append(el('small', conversation.title));
    button.onclick = () => run('conversation', { id: conversation.id });
    nav.append(button);
  }
  $('conversation-count').textContent = view.conversations.length;
  $('tasks').replaceChildren();
  $('toggle-tasks').textContent = view.tasks ? 'Hide' : 'Show';
  const nodes = Object.values(view.tasks?.tasks || {});
  if (!nodes.length) $('tasks').append(el('p', view.tasks ? 'No active tasks. New work appears here.' : 'Task panel hidden.', 'muted'));
  for (const task of nodes) {
    const node = el('div', undefined, 'task');
    node.append(el('strong', `${task.kind} #${task.id}`));
    const state = task.state;
    node.append(el('p', `${state.status}${state.phase ? ` · ${state.phase}` : ''}${state.on ? ` · waiting on ${state.on.join(', ')}` : ''}${state.outcome ? ` · ${state.outcome}` : ''}`));
    node.append(el('p', `Conversation ${task.conversationId}${task.owner !== undefined ? ` · owner #${task.owner}` : ''}${task.background ? ' · background' : ''}${task.abortRequested ? ' · aborting' : ''}`));
    if (task.conversations.length) node.append(el('p', `Owns conversations ${task.conversations.join(', ')}`));
    $('tasks').append(node);
  }
}
function controls() {
  document.querySelectorAll('[data-control]').forEach(button => { button.disabled = !online || pending; });
  prompt.disabled = !online;
  if (view) {
    const live = view.conversation.docs['pi.live'] || {};
    $('abort').disabled = !online || !(live.run || live.compactions?.length);
    $('send').textContent = live.run ? 'Steer ↑' : 'Send ↑';
  }
}
function alerts() {
  $('alerts').replaceChildren();
  for (const notice of [...(view?.notices || []).slice(-3), ...(localError ? [{ message: localError, level: 'error' }] : [])]) $('alerts').append(el('p', notice.message, notice.level));
}
function render() {
  const id = view.conversation.conversation.id;
  if (id !== selectedConversation) {
    if (selectedConversation !== undefined) drafts.set(selectedConversation, prompt.value);
    prompt.value = drafts.get(id) || '';
    selectedConversation = id; following = true; opened.clear();
  }
  const docs = view.conversation.docs;
  const agent = docs['pi.agent'] || {};
  $('cwd').textContent = view.session.cwd.split(/[\\/]/).filter(Boolean).at(-1) || view.session.cwd;
  $('cwd').title = view.session.cwd;
  $('session-id').textContent = `SESSION ${view.session.id}`;
  $('session-id').title = view.session.directory;
  $('conversation-title').textContent = view.conversations.find(c => c.id === id)?.label || `Conversation ${id}`;
  $('model').textContent = agent.model?.modelId || 'Select model';
  $('model').title = agent.model ? `${agent.model.provider}/${agent.model.modelId}` : 'Choose a model';
  $('thinking').textContent = `Thinking: ${agent.thinkingLevel || 'off'}`;
  $('status').textContent = statusOf(docs['pi.live']);
  const usage = usageOf(view);
  const format = number => Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(number);
  const model = view.models.find(m => m.provider === agent.model?.provider && m.modelId === agent.model?.modelId);
  const context = model?.contextWindow && usage.context !== undefined ? ` · ${(usage.context / model.contextWindow * 100).toFixed(1)}% context` : '';
  $('usage').textContent = `↑ ${format(usage.input)} ↓ ${format(usage.output)} · $${usage.cost.toFixed(3)}${context}`;
  $('usage').title = `Cache read: ${usage.cacheRead}; cache write: ${usage.cacheWrite}. Cost is provider-reported or estimated usage, not an invoice.`;
  const queued = docs['pi.inbox']?.items || [];
  $('queue').hidden = !queued.length; $('queue').replaceChildren();
  for (const item of queued) $('queue').append(el('p', `${item.mode === 'followUp' ? 'Follow-up' : item.mode}: ${item.mode === 'write' ? item.entry.kind : textContent(item.content)}`));
  renderTranscript(); renderNavigation(); alerts(); controls();
  if ($('activity-dialog')?.open) renderActivity();
}
async function command(action, payload = {}) {
  const response = await fetch('/api/command', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action, conversationId: selectedConversation, requestId: crypto.randomUUID() }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
async function run(action, payload) {
  if (!online || (pending && action !== 'abort')) return false;
  if (action !== 'abort') pending = true;
  localError = ''; alerts(); controls();
  try { await command(action, payload); return true; }
  catch (error) { localError = `Unable to confirm command: ${error.message} Check the transcript before retrying.`; alerts(); return false; }
  finally { if (action !== 'abort') pending = false; controls(); }
}
function showModels() {
  if (!view) return;
  $('model-search').value = ''; filterModels(); $('model-dialog').showModal(); $('model-search').focus();
}
function filterModels() {
  $('models').replaceChildren();
  const query = $('model-search').value.toLowerCase();
  const selected = view.conversation.docs['pi.agent']?.model;
  const models = view.models.filter(m => `${m.provider} ${m.modelId} ${m.name}`.toLowerCase().includes(query));
  if (!models.length) $('models').append(el('p', 'No available models. Configure credentials with Pi /login, then restart this server.', 'muted'));
  for (const model of models) {
    const button = el('button', model.name || model.modelId, model.provider === selected?.provider && model.modelId === selected?.modelId ? 'selected' : '');
    button.append(el('small', `${model.provider} / ${model.modelId}`));
    button.onclick = async () => { if (await run('model', { provider: model.provider, modelId: model.modelId })) $('model-dialog').close(); };
    $('models').append(button);
  }
}
function showAgents() {
  if (!view) return;
  const dialog = el('dialog');
  const head = el('div', undefined, 'dialog-head'); head.append(el('h2', 'Conversations'));
  const close = el('button', '×'); close.setAttribute('aria-label', 'Close'); close.onclick = () => dialog.close(); head.append(close); dialog.append(head);
  const list = el('div', undefined, 'model-list');
  for (const conversation of view.conversations) {
    const button = el('button', conversation.label); if (conversation.title) button.append(el('small', conversation.title));
    button.onclick = async () => { if (await run('conversation', { id: conversation.id })) dialog.close(); }; list.append(button);
  }
  dialog.append(list); dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
async function submit(mode = 'steer') {
  const text = prompt.value.trim(); if (!text || !online || pending) return;
  const before = prompt.value;
  if (mode === 'steer' && text.startsWith('/')) {
    if (text === '/model') showModels();
    else if (text === '/agents') showAgents();
    else if (text === '/help') $('help-dialog').showModal();
    else if (text === '/tasks') { if (!await run('tasks')) return; }
    else if (/^\/compact(?:\s|$)/.test(text)) { if (!await run('compact', { instructions: text.slice(8).trim() })) return; }
    else { localError = 'Unknown command. Use /help to see available commands.'; alerts(); return; }
    prompt.value = ''; return;
  }
  const id = selectedConversation;
  if (await run('submit', { text, whenBusy: mode })) {
    if (selectedConversation === id && prompt.value === before) prompt.value = '';
    drafts.delete(id); following = true;
  }
}
$('composer').onsubmit = event => { event.preventDefault(); void submit(); };
$('follow-up').onclick = () => submit('followUp');
$('abort').onclick = () => run('abort');
$('model').onclick = showModels;
$('thinking').onclick = () => run('thinking');
$('toggle-tasks').onclick = () => run('tasks');
$('compact').onclick = () => $('compact-dialog').showModal();
$('compact-form').onsubmit = async event => { event.preventDefault(); if (await run('compact', { instructions: $('compact-instructions').value })) $('compact-dialog').close(); };
$('model-search').oninput = filterModels;
$('help').onclick = () => $('help-dialog').showModal();
function renderActivity() {
  $('activity-content').replaceChildren($('tasks').cloneNode(true));
  $('activity-content').firstElementChild.removeAttribute('id');
}
const activity = el('button', 'Tasks', 'quiet');
activity.id = 'activity';
activity.onclick = async () => {
  if (!view) return;
  if (!view.tasks) await run('tasks');
  renderActivity(); $('activity-dialog').showModal();
};
$('help').before(activity);
$('expand').onclick = () => {
  expanded = !expanded; opened.clear();
  transcript.querySelectorAll('details').forEach(node => { node.open = expanded; });
  $('expand').textContent = `${expanded ? 'Collapse' : 'Expand'} tool details`;
};
$('latest').onclick = () => { following = true; transcript.scrollTop = transcript.scrollHeight; $('latest').hidden = true; };
transcript.onscroll = () => { following = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 60; $('latest').hidden = following; };
new ResizeObserver(() => { if (following) transcript.scrollTop = transcript.scrollHeight; }).observe(transcript);
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => $(button.dataset.close).close(); });
document.querySelectorAll('[data-suggestion]').forEach(button => { button.onclick = () => { prompt.value = button.dataset.suggestion; prompt.focus(); }; });
const agents = el('button', 'Switch', 'quiet'); agents.id = 'agents'; agents.title = 'Switch conversation / subagent'; agents.onclick = showAgents;
$('conversation-title').after(agents);
prompt.onkeydown = event => {
  if (event.isComposing) return;
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(event.altKey ? 'followUp' : 'steer'); }
};
document.addEventListener('keydown', event => {
  if (event.isComposing || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') { event.preventDefault(); void run('abort'); }
  if (!event.altKey) return;
  if (event.key.toLowerCase() === 'm') { event.preventDefault(); showModels(); }
  if (event.key.toLowerCase() === 't') { event.preventDefault(); void run('thinking'); }
  if (event.key.toLowerCase() === 'o') { event.preventDefault(); $('expand').click(); }
});
function connection(connected, label) {
  online = connected; $('connection').textContent = label; $('connection-dot').classList.toggle('saved', connected); controls();
}
async function connect() {
  if (!token) { connection(false, 'Launch URL required'); localError = 'Open the full URL printed by the start command, including its #token fragment.'; alerts(); return; }
  let delay = 1000;
  for (;;) {
    let reader;
    try {
      const response = await fetch('/api/events', { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 401) { connection(false, 'Launch URL expired'); localError = 'Open the new URL printed in the terminal after restarting the server.'; alerts(); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          if (!frame.startsWith('data: ')) continue;
          view = JSON.parse(frame.slice(6)); connection(true, 'Connected'); delay = 1000; render();
        }
      }
    } catch { /* Snapshot reconnect never replays a command. */ }
    finally { await reader?.cancel().catch(() => {}); }
    connection(false, 'Reconnecting…');
    await new Promise(resolve => setTimeout(resolve, delay)); delay = Math.min(delay * 2, 10000);
  }
}
controls(); void connect();
