import { createServer } from "http";
import { WebSocketServer } from "ws";
import { watch } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Watch both browser directories
const distDirChrome = join(__dirname, "..", "dist-chrome");
const distDirFirefox = join(__dirname, "..", "dist-firefox");

const PORT = 8765; // Fixed port for WebSocket server
const server = createServer();
const wss = new WebSocketServer({ server });

const clients = new Set();

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("[DevServer] Client connected");
  clients.add(ws);

  ws.on("close", () => {
    console.log("[DevServer] Client disconnected");
    clients.delete(ws);
  });

  ws.on("error", (error) => {
    console.error("[DevServer] WebSocket error:", error);
    clients.delete(ws);
  });

  // Send initial connection confirmation
  ws.send(JSON.stringify({ type: "connected" }));
});

// Watch for changes in both dist directories
const watcherChrome = watch(distDirChrome, { recursive: true }, (eventType, filename) => {
  if (filename) {
    console.log(`[DevServer] Chrome file changed: ${filename}`);

    // Send reload message to all connected clients
    const message = JSON.stringify({ type: "reload", browser: "chrome", file: filename });
    clients.forEach((client) => {
      if (client.readyState === 1) { // OPEN state
        client.send(message);
      }
    });
  }
});

const watcherFirefox = watch(distDirFirefox, { recursive: true }, (eventType, filename) => {
  if (filename) {
    console.log(`[DevServer] Firefox file changed: ${filename}`);

    // Send reload message to all connected clients
    const message = JSON.stringify({ type: "reload", browser: "firefox", file: filename });
    clients.forEach((client) => {
      if (client.readyState === 1) { // OPEN state
        client.send(message);
      }
    });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`[DevServer] WebSocket server running on ws://localhost:${PORT}`);
  console.log(`[DevServer] Watching for changes in ${distDirChrome} and ${distDirFirefox}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[DevServer] Shutting down...");
  watcherChrome.close();
  watcherFirefox.close();
  clients.forEach((client) => client.close());
  server.close(() => {
    process.exit(0);
  });
});