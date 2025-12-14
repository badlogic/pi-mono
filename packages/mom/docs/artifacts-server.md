# Artifacts Server

Share HTML files, visualizations, and interactive demos publicly via Cloudflare Tunnel with live reload support.

## What is it?

The artifacts server lets Mom create HTML/JS/CSS files that you can instantly view in a browser, with WebSocket-based live reload for development. Perfect for dashboards, visualizations, prototypes, and interactive demos.

## Installation

### 1. Install Dependencies

**Node.js packages:**
```bash
cd /workspace/artifacts
npm init -y
npm install express ws chokidar
```

**Cloudflared (Cloudflare Tunnel):**
```bash
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

### 2. Create Server

Save this as `/workspace/artifacts/server.js`:

```javascript
#!/usr/bin/env node

const express = require('express');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 8080;
const FILES_DIR = path.join(__dirname, 'files');

// Ensure files directory exists
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, clientTracking: true });

// Track connected WebSocket clients
const clients = new Set();

// WebSocket connection handler with error handling
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  clients.add(ws);
  
  ws.on('error', (err) => {
    console.error('WebSocket client error:', err.message);
    clients.delete(ws);
  });
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
});

wss.on('error', (err) => {
  console.error('WebSocket server error:', err.message);
});

// Watch for file changes
const watcher = chokidar.watch(FILES_DIR, {
  persistent: true,
  ignoreInitial: true,
  depth: 99, // Watch all subdirectory levels
  ignorePermissionErrors: true,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 50
  }
});

watcher.on('all', (event, filepath) => {
  console.log(`File ${event}: ${filepath}`);
  
  // If a new directory is created, explicitly watch it
  // This ensures newly created artifact folders are monitored without restart
  if (event === 'addDir') {
    watcher.add(filepath);
    console.log(`Now watching directory: ${filepath}`);
  }
  
  const relativePath = path.relative(FILES_DIR, filepath);
  const message = JSON.stringify({
    type: 'reload',
    file: relativePath
  });
  
  clients.forEach(client => {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch (err) {
        console.error('Error sending to client:', err.message);
        clients.delete(client);
      }
    } else {
      clients.delete(client);
    }
  });
});

watcher.on('error', (err) => {
  console.error('File watcher error:', err.message);
});

// Cache-busting headers
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  next();
});

// Inject live reload script for HTML files with ?ws=true
app.use((req, res, next) => {
  if (!req.path.endsWith('.html') || req.query.ws !== 'true') {
    return next();
  }
  
  const filePath = path.join(FILES_DIR, req.path);
  
  // Security: Prevent path traversal attacks
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(FILES_DIR);
  if (!resolvedPath.startsWith(resolvedBase)) {
    return res.status(403).send('Forbidden: Path traversal detected');
  }
  
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      return next();
    }
    
    const liveReloadScript = `
<script>
(function() {
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'position:fixed;bottom:10px;left:10px;background:rgba(0,150,0,0.9);color:white;padding:15px;border-radius:8px;font-family:monospace;font-size:12px;max-width:90%;z-index:9999;word-break:break-all';
  errorDiv.textContent = 'Live reload: connecting...';
  document.body.appendChild(errorDiv);
  
  function showStatus(msg, isError) {
    errorDiv.textContent = msg;
    errorDiv.style.background = isError ? 'rgba(255,0,0,0.9)' : 'rgba(0,150,0,0.9)';
    if (!isError) setTimeout(() => errorDiv.style.display = 'none', 3000);
  }
  
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = protocol + window.location.host;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => showStatus('Live reload connected!', false);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'reload') {
        showStatus('File changed, reloading...', false);
        setTimeout(() => window.location.reload(), 500);
      }
    };
    ws.onerror = () => showStatus('Connection failed', true);
    ws.onclose = (e) => showStatus('Disconnected: ' + e.code, true);
  } catch (err) {
    showStatus('Error: ' + err.message, true);
  }
})();
</script>`;
    
    if (data.includes('</body>')) {
      data = data.replace('</body>', liveReloadScript + '</body>');
    } else {
      data = data + liveReloadScript;
    }
    
    res.type('html').send(data);
  });
});

// Serve static files
app.use(express.static(FILES_DIR));

// Error handling
app.use((err, req, res, next) => {
  console.error('Express error:', err.message);
  res.status(500).send('Internal server error');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
  }
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing gracefully');
  watcher.close();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing gracefully');
  watcher.close();
  server.close(() => process.exit(0));
});

// Start server
server.listen(PORT, () => {
  console.log(`Artifacts server running on http://localhost:${PORT}`);
  console.log(`Serving files from: ${FILES_DIR}`);
  console.log(`Add ?ws=true to any URL for live reload`);
});
```

Make executable:
```bash
chmod +x /workspace/artifacts/server.js
```

### 3. Create Startup Script

Save this as `/workspace/artifacts/start-server.sh`:

```bash
#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting artifacts server..."

# Start Node.js server in background
node server.js > /tmp/server.log 2>&1 &
NODE_PID=$!

# Wait for server to be ready
sleep 2

# Start cloudflare tunnel
echo "Starting Cloudflare Tunnel..."
cloudflared tunnel --url http://localhost:8080 2>&1 | tee /tmp/cloudflared.log &
TUNNEL_PID=$!

# Wait for tunnel to establish
sleep 5

# Extract and display public URL
PUBLIC_URL=$(grep -o 'https://.*\.trycloudflare\.com' /tmp/cloudflared.log | head -1)

if [ -n "$PUBLIC_URL" ]; then
  echo ""
  echo "=========================================="
  echo "Artifacts server is running!"
  echo "=========================================="
  echo "Public URL: $PUBLIC_URL"
  echo "Files directory: $SCRIPT_DIR/files/"
  echo ""
  echo "Add ?ws=true to any URL for live reload"
  echo "Example: $PUBLIC_URL/test.html?ws=true"
  echo "=========================================="
  echo ""
  
  echo "$PUBLIC_URL" > /tmp/artifacts-url.txt
else
  echo "Warning: Could not extract public URL"
fi

# Keep script running
cleanup() {
  echo "Shutting down..."
  kill $NODE_PID 2>/dev/null || true
  kill $TUNNEL_PID 2>/dev/null || true
  exit 0
}

trap cleanup INT TERM
wait $NODE_PID $TUNNEL_PID
```

Make executable:
```bash
chmod +x /workspace/artifacts/start-server.sh
```

## Directory Structure

```
/workspace/artifacts/
├── server.js              # Node.js server
├── start-server.sh        # Startup script
├── package.json           # Dependencies
├── node_modules/          # Installed packages
└── files/                 # PUT YOUR ARTIFACTS HERE
    ├── 2025-12-14-demo/
    │   ├── index.html
    │   ├── style.css
    │   └── logo.png
    ├── 2025-12-15-chart/
    │   └── index.html
    └── test.html (standalone OK)
```

## Usage

### Starting the Server

```bash
cd /workspace/artifacts
./start-server.sh
```

This will:
1. Start Node.js server on localhost:8080
2. Create Cloudflare Tunnel with public URL
3. Print the URL (e.g., `https://random-words-123.trycloudflare.com`)
4. Save URL to `/tmp/artifacts-url.txt`

**Note:** URL changes every time you restart (free Cloudflare Tunnel limitation).

### Creating Artifacts

**Folder organization:**
- Create one subfolder per artifact: `$(date +%Y-%m-%d)-description/`
- Put main file as `index.html` for clean URLs
- Include images, CSS, JS, data in same folder
- CDN resources (Tailwind, Three.js, etc.) work fine

**Example:**
```bash
mkdir -p /workspace/artifacts/files/$(date +%Y-%m-%d)-dashboard
cat > /workspace/artifacts/files/$(date +%Y-%m-%d)-dashboard/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white p-8">
    <h1 class="text-4xl font-bold">My Dashboard</h1>
    <img src="logo.png" alt="Logo">
</body>
</html>
EOF
```

**Access:**
- **IMPORTANT:** Always use full `index.html` path for live reload to work
- Development (live reload): `https://your-url.trycloudflare.com/2025-12-14-dashboard/index.html?ws=true`
- Share (static): `https://your-url.trycloudflare.com/2025-12-14-dashboard/index.html`

**Note:** Folder URLs (`/folder/`) won't inject WebSocket script, must use `/folder/index.html`

### Live Reload

When viewing with `?ws=true`:
1. You'll see a green box at bottom-left: "Live reload connected!"
2. Edit any file in the artifact folder
3. Page auto-reloads within 1 second
4. Perfect for iterating on designs

**Remove `?ws=true` when sharing** - no WebSocket overhead for viewers.

## How It Works

**Architecture:**
- Node.js server (Express) serves static files from `/workspace/artifacts/files/`
- Chokidar file watcher monitors for changes (including new directories)
- WebSocket broadcasts reload messages to connected clients
- Cloudflare Tunnel exposes localhost to internet with public HTTPS URL
- Client-side script auto-reloads browser when file changes detected

**Security:**
- Path traversal protection prevents access outside `files/` directory
- Only files in `/workspace/artifacts/files/` are served
- Cache-busting headers prevent stale content

**File Watching:**
- Automatically detects new artifact folders created after server start
- Watches all subdirectories recursively (depth: 99)
- No server restart needed when creating new projects

## Troubleshooting

**502 Bad Gateway:**
- Node server crashed. Check logs: `cat /tmp/server.log`
- Restart: `cd /workspace/artifacts && node server.js &`

**WebSocket not connecting:**
- Check browser console for errors
- Ensure `?ws=true` is in URL
- Red/yellow box at bottom-left shows connection errors
- Use full `index.html` path, not folder URL

**Files not updating:**
- Check file watcher logs: `tail /tmp/server.log`
- Ensure files are in `/workspace/artifacts/files/`
- Should see "File change:" messages in logs

**Port already in use:**
- Kill existing server: `pkill node`
- Wait 2 seconds, restart

**Browser caching issues:**
- Server sends no-cache headers
- Hard refresh: Ctrl+Shift+R
- Add version parameter: `?ws=true&v=2`

## Example Session

**You:** "Create a Three.js spinning cube demo with Tailwind UI"

**Mom creates:**
```
/workspace/artifacts/files/2025-12-14-threejs-cube/
├── index.html (Three.js from CDN, Tailwind from CDN)
└── screenshot.png
```

**Access:** `https://concepts-rome-123.trycloudflare.com/2025-12-14-threejs-cube/index.html?ws=true`

**You:** "Make the cube purple and add a grid"

**Mom:** Edits `index.html`

**Result:** Your browser auto-reloads, showing purple cube with grid (within 1 second)

## Technical Notes

**Why not Node.js fs.watch?**
- `fs.watch` with `recursive: true` only works on macOS/Windows
- On Linux (Docker), it doesn't support recursive watching
- Chokidar is the most reliable cross-platform solution
- We explicitly add new directories when detected to ensure monitoring

**WebSocket vs Server-Sent Events:**
- WebSocket works reliably through Cloudflare Tunnel
- All connected clients reload when ANY file changes (simple approach)
- For production, you'd filter by current page path

**Cloudflare Tunnel Free Tier:**
- Random subdomain changes on each restart
- No persistent URLs without paid account
- WebSocket support is reliable despite being free tier
