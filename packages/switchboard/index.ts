#!/usr/bin/env npx tsx
/**
 * Switchboard - Real-time Inter-Agent Communication Service
 *
 * A lightweight daemon that handles message routing between Pi agents.
 * Supports both HTTP (pull) and WebSocket (push) for true real-time communication.
 *
 * Usage:
 *   npx tsx ~/.pi/agent/services/switchboard/index.ts
 *   # Or with custom port:
 *   SWITCHBOARD_PORT=7890 npx tsx ~/.pi/agent/services/switchboard/index.ts
 *
 * HTTP API (Pull):
 *   POST /emit           - Send a message to an agent
 *   GET  /inbox/:agent   - List messages for an agent
 *   DELETE /inbox/:agent/:id - Acknowledge/delete a message
 *   GET  /health         - Health check
 *   GET  /agents         - List registered agents
 *
 * WebSocket API (Push):
 *   Connect: ws://127.0.0.1:7890/ws?agent=<name>
 *   Receive: {"type":"message","data":<Message>}
 *   Receive: {"type":"ack","id":"<messageId>"}
 *   Send:    {"type":"emit","to":"<agent>","message":"<text>",...}
 *   Send:    {"type":"ack","id":"<messageId>"}
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { WebSocketServer, WebSocket } from "ws";

// Configuration
const PORT = parseInt(process.env.SWITCHBOARD_PORT || "7890", 10);
const PERSISTENCE_FILE = path.join(os.homedir(), ".pi/agent/services/switchboard/messages.json");
const PID_FILE = path.join(os.homedir(), ".pi/agent/services/switchboard/switchboard.pid");
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Types
interface Message {
  id: string;
  from: string;
  to: string;
  type: "task" | "info" | "question" | "response" | "alert";
  priority: "low" | "normal" | "high" | "urgent";
  subject?: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface AgentRegistration {
  name: string;
  cwd: string;
  registeredAt: string;
  lastSeen: string;
  connected: boolean;
}

interface WebSocketMessage {
  type: "emit" | "ack" | "ping" | "subscribe";
  // For emit
  to?: string;
  message?: string;
  msgType?: Message["type"];
  priority?: Message["priority"];
  subject?: string;
  metadata?: Record<string, unknown>;
  // For ack
  id?: string;
}

// In-memory stores
const inboxes: Map<string, Message[]> = new Map();
const agents: Map<string, AgentRegistration> = new Map();
const connections: Map<string, Set<WebSocket>> = new Map(); // agent -> websockets

// Persistence
function loadState(): void {
  try {
    if (fs.existsSync(PERSISTENCE_FILE)) {
      const data = JSON.parse(fs.readFileSync(PERSISTENCE_FILE, "utf-8"));
      if (data.inboxes) {
        for (const [agent, messages] of Object.entries(data.inboxes)) {
          inboxes.set(agent, messages as Message[]);
        }
      }
      console.log(`[Switchboard] Loaded ${inboxes.size} inboxes from persistence`);
    }
  } catch (e) {
    console.error("[Switchboard] Failed to load state:", e);
  }
}

function saveState(): void {
  try {
    const data = {
      inboxes: Object.fromEntries(inboxes),
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(PERSISTENCE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[Switchboard] Failed to save state:", e);
  }
}

// Generate unique ID
function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Push message to connected agent via WebSocket
function pushToAgent(agentName: string, message: Message): boolean {
  const sockets = connections.get(agentName);
  if (!sockets || sockets.size === 0) return false;

  const payload = JSON.stringify({ type: "message", data: message });
  let pushed = false;

  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      pushed = true;
    }
  }

  if (pushed) {
    console.log(`[Switchboard] Pushed message ${message.id} to ${agentName} via WebSocket`);
  }

  return pushed;
}

// Notify agent that a message was acknowledged
function notifyAck(agentName: string, messageId: string): void {
  const sockets = connections.get(agentName);
  if (!sockets) return;

  const payload = JSON.stringify({ type: "ack", id: messageId });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// Parse JSON body from request
async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Send JSON response
function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// Emit a message (used by both HTTP and WebSocket)
function emitMessage(from: string, to: string, text: string, options: Partial<Message> = {}): Message {
  const message: Message = {
    id: generateId(),
    from,
    to,
    type: options.type || "info",
    priority: options.priority || "normal",
    subject: options.subject,
    message: text,
    timestamp: new Date().toISOString(),
    metadata: options.metadata
  };

  // Add to recipient's inbox
  const inbox = inboxes.get(to) || [];
  inbox.push(message);
  inboxes.set(to, inbox);

  // Sort by priority (urgent first)
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  inbox.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  saveState();

  // Try to push via WebSocket
  const pushed = pushToAgent(to, message);
  console.log(`[Switchboard] Message ${message.id}: ${from} -> ${to} (pushed: ${pushed})`);

  return message;
}

// Acknowledge a message
function ackMessage(agentName: string, messageId: string): Message | null {
  const inbox = inboxes.get(agentName);
  if (!inbox) return null;

  const index = inbox.findIndex((m) => m.id === messageId);
  if (index === -1) return null;

  const [removed] = inbox.splice(index, 1);
  saveState();

  // Notify sender that message was acknowledged
  notifyAck(removed.from, messageId);

  console.log(`[Switchboard] Message ${messageId} acknowledged by ${agentName}`);
  return removed;
}

// HTTP Route handlers
async function handleEmit(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = (await parseBody(req)) as Partial<Message> & { to: string };

  if (!body.to || !body.message) {
    sendJson(res, 400, { error: "Missing required fields: 'to' and 'message'" });
    return;
  }

  const message = emitMessage(body.from || "anonymous", body.to, body.message, {
    type: body.type,
    priority: body.priority,
    subject: body.subject,
    metadata: body.metadata
  });

  sendJson(res, 201, { success: true, id: message.id, message });
}

async function handleInbox(req: http.IncomingMessage, res: http.ServerResponse, agent: string): Promise<void> {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);

  // Update agent's last seen
  const registration = agents.get(agent);
  if (registration) {
    registration.lastSeen = new Date().toISOString();
    agents.set(agent, registration);
  }

  const inbox = inboxes.get(agent) || [];
  const messages = inbox.slice(0, limit);

  sendJson(res, 200, {
    agent,
    count: inbox.length,
    messages,
    hasMore: inbox.length > limit
  });
}

async function handleAck(res: http.ServerResponse, agent: string, messageId: string): Promise<void> {
  const removed = ackMessage(agent, messageId);
  if (!removed) {
    sendJson(res, 404, { error: "Message not found" });
    return;
  }
  sendJson(res, 200, { success: true, acknowledged: removed });
}

async function handleRegister(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = (await parseBody(req)) as { name: string; cwd?: string };

  if (!body.name) {
    sendJson(res, 400, { error: "Missing required field: 'name'" });
    return;
  }

  const isConnected = (connections.get(body.name)?.size || 0) > 0;

  const registration: AgentRegistration = {
    name: body.name,
    cwd: body.cwd || process.cwd(),
    registeredAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    connected: isConnected
  };

  agents.set(body.name, registration);

  // Ensure inbox exists
  if (!inboxes.has(body.name)) {
    inboxes.set(body.name, []);
  }

  console.log(`[Switchboard] Agent registered: ${body.name} (connected: ${isConnected})`);
  sendJson(res, 200, { success: true, agent: registration });
}

async function handleAgents(res: http.ServerResponse): Promise<void> {
  const agentList = Array.from(agents.entries()).map(([name, info]) => ({
    name,
    ...info,
    connected: (connections.get(name)?.size || 0) > 0,
    inboxCount: (inboxes.get(name) || []).length
  }));

  sendJson(res, 200, { agents: agentList });
}

async function handleClear(res: http.ServerResponse, agent: string): Promise<void> {
  const inbox = inboxes.get(agent);
  if (!inbox) {
    sendJson(res, 404, { error: "Agent inbox not found" });
    return;
  }

  const count = inbox.length;
  inboxes.set(agent, []);
  saveState();
  console.log(`[Switchboard] Cleared ${count} messages from ${agent}'s inbox`);

  sendJson(res, 200, { success: true, cleared: count });
}

// Main HTTP request handler
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const method = req.method || "GET";
  const pathname = url.pathname;

  // CORS headers for local access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Health check
    if (pathname === "/health" && method === "GET") {
      const connectedCount = Array.from(connections.values()).reduce((sum, set) => sum + set.size, 0);
      sendJson(res, 200, {
        status: "ok",
        uptime: process.uptime(),
        agents: agents.size,
        connectedAgents: connectedCount,
        totalMessages: Array.from(inboxes.values()).reduce((sum, inbox) => sum + inbox.length, 0)
      });
      return;
    }

    // Emit message
    if (pathname === "/emit" && method === "POST") {
      await handleEmit(req, res);
      return;
    }

    // Register agent
    if (pathname === "/register" && method === "POST") {
      await handleRegister(req, res);
      return;
    }

    // List agents
    if (pathname === "/agents" && method === "GET") {
      await handleAgents(res);
      return;
    }

    // Inbox operations
    const inboxMatch = pathname.match(/^\/inbox\/([^/]+)(?:\/([^/]+))?$/);
    if (inboxMatch) {
      const agent = decodeURIComponent(inboxMatch[1]);
      const messageId = inboxMatch[2] ? decodeURIComponent(inboxMatch[2]) : null;

      if (method === "GET" && !messageId) {
        await handleInbox(req, res, agent);
        return;
      }

      if (method === "DELETE" && messageId) {
        await handleAck(res, agent, messageId);
        return;
      }

      if (method === "DELETE" && !messageId) {
        await handleClear(res, agent);
        return;
      }
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (e) {
    console.error("[Switchboard] Error:", e);
    sendJson(res, 500, { error: String(e) });
  }
}

// WebSocket connection handler
function handleWebSocket(ws: WebSocket, agentName: string): void {
  console.log(`[Switchboard] WebSocket connected: ${agentName}`);

  // Add to connections
  if (!connections.has(agentName)) {
    connections.set(agentName, new Set());
  }
  connections.get(agentName)!.add(ws);

  // Update agent registration
  const registration = agents.get(agentName);
  if (registration) {
    registration.connected = true;
    registration.lastSeen = new Date().toISOString();
  }

  // Ensure inbox exists
  if (!inboxes.has(agentName)) {
    inboxes.set(agentName, []);
  }

  // Send any pending messages immediately
  const inbox = inboxes.get(agentName) || [];
  if (inbox.length > 0) {
    console.log(`[Switchboard] Sending ${inbox.length} pending messages to ${agentName}`);
    for (const message of inbox) {
      ws.send(JSON.stringify({ type: "message", data: message }));
    }
  }

  // Send connection confirmation
  ws.send(JSON.stringify({
    type: "connected",
    agent: agentName,
    pendingMessages: inbox.length
  }));

  // Handle incoming messages
  ws.on("message", (data) => {
    try {
      const msg: WebSocketMessage = JSON.parse(data.toString());

      switch (msg.type) {
        case "emit":
          if (msg.to && msg.message) {
            const message = emitMessage(agentName, msg.to, msg.message, {
              type: msg.msgType,
              priority: msg.priority,
              subject: msg.subject,
              metadata: msg.metadata
            });
            ws.send(JSON.stringify({ type: "emitted", id: message.id }));
          }
          break;

        case "ack":
          if (msg.id) {
            const removed = ackMessage(agentName, msg.id);
            ws.send(JSON.stringify({
              type: "acked",
              id: msg.id,
              success: !!removed
            }));
          }
          break;

        case "ping":
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          break;
      }
    } catch (e) {
      console.error(`[Switchboard] WebSocket message error from ${agentName}:`, e);
    }
  });

  // Handle disconnection
  ws.on("close", () => {
    console.log(`[Switchboard] WebSocket disconnected: ${agentName}`);
    connections.get(agentName)?.delete(ws);

    const registration = agents.get(agentName);
    if (registration) {
      registration.connected = (connections.get(agentName)?.size || 0) > 0;
    }
  });

  ws.on("error", (err) => {
    console.error(`[Switchboard] WebSocket error for ${agentName}:`, err);
  });
}

// Start server
function start(): void {
  loadState();

  const server = http.createServer(handleRequest);

  // WebSocket server on same port
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const agentName = url.searchParams.get("agent");

    if (!agentName) {
      ws.close(4000, "Missing agent parameter");
      return;
    }

    handleWebSocket(ws, agentName);
  });

  // Heartbeat to detect dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as any).isAlive === false) {
        return ws.terminate();
      }
      (ws as any).isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => clearInterval(heartbeat));

  server.listen(PORT, "127.0.0.1", () => {
    fs.writeFileSync(PID_FILE, String(process.pid));
    console.log(`[Switchboard] Running on http://127.0.0.1:${PORT}`);
    console.log(`[Switchboard] WebSocket on ws://127.0.0.1:${PORT}?agent=<name>`);
    console.log(`[Switchboard] PID: ${process.pid}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[Switchboard] Shutting down...");
    saveState();

    // Close all WebSocket connections
    wss.clients.forEach((ws) => ws.close(1001, "Server shutting down"));

    try {
      fs.unlinkSync(PID_FILE);
    } catch {}
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
