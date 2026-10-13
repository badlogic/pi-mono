import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/view.js', ['view.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const policy = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function error(status, message) { return Object.assign(new Error(message), { status }); }
async function body(req) {
  if (req.headers['content-type'] !== 'application/json') throw error(415, 'Expected application/json.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw error(413, 'Command exceeds 256 KiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error(400, 'Invalid JSON.'); }
}

/** Browser transport only. The durable runtime remains the single source of truth. */
export async function startServer(durable, { port = 4317 } = {}) {
  const token = randomBytes(32).toString('hex');
  const clients = new Set();
  const receipts = new Map();
  let origin;
  let timer;
  let queue = Promise.resolve();
  let closing = false;
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  const authorized = req => {
    const candidate = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  };
  const publish = () => {
    timer = undefined;
    if (!clients.size) return;
    const frame = `data: ${JSON.stringify(durable.view.current())}\n\n`;
    for (const res of clients) {
      // Full snapshots make reconnect safe; don't accumulate unbounded slow-client buffers.
      if (!res.write(frame)) { clients.delete(res); res.destroy(); }
    }
  };
  const unsubscribe = durable.view.subscribe(() => { timer ??= setTimeout(publish, 40); });
  const heartbeat = setInterval(() => {
    for (const res of clients) if (!res.write(': keepalive\n\n')) { clients.delete(res); res.destroy(); }
  }, 15000);
  heartbeat.unref();

  async function execute(command) {
    const snapshot = durable.view.current();
    if (command.conversationId !== snapshot.conversation.conversation.id) {
      throw error(409, 'The active conversation changed. Review it before retrying.');
    }
    const controller = durable.controller;
    switch (command.action) {
      case 'submit':
        if (typeof command.text !== 'string' || !command.text.trim()) throw error(400, 'Enter a message.');
        if (!['steer', 'followUp'].includes(command.whenBusy)) throw error(400, 'Invalid queue mode.');
        await controller.submit(command.text.trim(), command.whenBusy); break;
      case 'abort': await controller.abort(); break;
      case 'compact':
        if (command.instructions !== undefined && typeof command.instructions !== 'string') throw error(400, 'Invalid instructions.');
        await controller.compact(command.instructions || undefined); break;
      case 'thinking': await controller.cycleThinking(); break;
      case 'tasks': await controller.toggleTasks(); break;
      case 'model': {
        const model = snapshot.models.find(m => m.provider === command.provider && m.modelId === command.modelId);
        if (!model) throw error(400, 'Model unavailable.');
        await controller.setModel({ provider: model.provider, modelId: model.modelId }); break;
      }
      case 'conversation':
        if (!snapshot.conversations.some(c => c.id === command.id)) throw error(400, 'Conversation unavailable.');
        await controller.switchConversation(command.id); break;
      default: throw error(400, 'Unknown command.');
    }
    return { accepted: true };
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', policy);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (closing) throw error(503, 'Server is closing.');
      if (req.headers.host !== new URL(origin).host) throw error(403, 'Invalid host.');
      if (req.headers.origin && req.headers.origin !== origin) throw error(403, 'Cross-origin requests are not allowed.');
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (!authorized(req)) throw error(401, 'Open the full launch URL printed in the terminal.');
        if (req.method === 'GET' && url.pathname === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
          res.write(`data: ${JSON.stringify(durable.view.current())}\n\n`);
          clients.add(res);
          res.on('close', () => clients.delete(res));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/command') {
          const command = await body(req);
          if (!command || typeof command !== 'object' || Array.isArray(command) || !/^[\w-]{8,80}$/.test(command.requestId || '')) throw error(400, 'Invalid command identifier.');
          const signature = JSON.stringify(command);
          let receipt = receipts.get(command.requestId);
          if (receipt && receipt.signature !== signature) throw error(409, 'Command identifier already used.');
          if (!receipt) {
            // Never evict in-flight commands; bounded cache fails closed under overload.
            if (receipts.size >= 512) {
              const oldest = [...receipts].find(([, item]) => item.done);
              if (!oldest) throw error(429, 'Too many commands in flight.');
              receipts.delete(oldest[0]);
            }
            receipt = { signature, done: false };
            const operation = () => execute(command);
            receipt.promise = command.action === 'abort' ? operation() : queue.then(operation);
            if (command.action !== 'abort') queue = receipt.promise.catch(() => {});
            receipt.promise = receipt.promise.then(value => ({ status: 200, value }), e => ({ status: e.status || 500, value: { error: e.message } })).finally(() => { receipt.done = true; });
            receipts.set(command.requestId, receipt);
          }
          const result = await receipt.promise;
          json(res, result.status, result.value);
          return;
        }
        throw error(404, 'Unknown endpoint.');
      }
      const asset = assets.get(url.pathname);
      if (req.method !== 'GET' || !asset) throw error(404, 'Not found.');
      const content = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': asset[1] }); res.end(content);
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, { error: e.message });
      else res.destroy();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (e) { unsubscribe(); clearInterval(heartbeat); clearTimeout(timer); throw e; }
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, token, url: `${origin}/#token=${token}`,
    async close() {
      closing = true; unsubscribe(); clearTimeout(timer); clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
      await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    },
  };
}
