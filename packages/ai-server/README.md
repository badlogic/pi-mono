# @mariozechner/pi-ai-server

A lightweight local HTTP server that exposes [`@mariozechner/pi-ai`](../ai) over HTTP, so non-JavaScript projects (e.g. Python) can use its unified LLM API and OAuth authentication.

## Quick Start

```bash
# 1. Build (from monorepo root)
cd packages/ai && npm run build
cd ../ai-server && npm run build

# 2. (OAuth providers only) Log in first
node ../ai/dist/cli.js login google-gemini-cli

# 3. Start the server
node dist/server.js
# → pi-ai-server listening on http://127.0.0.1:3456
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Port to listen on |
| `HOST` | `127.0.0.1` | Host to bind to |
| `AUTH_FILE` | `packages/ai/auth.json` | Path to OAuth credentials file |

---

## API Reference

### `GET /providers`

Returns all supported providers and their authentication status.

```bash
curl http://127.0.0.1:3456/providers
```

```json
[
  { "id": "google-gemini-cli", "authType": "oauth", "authenticated": true },
  { "id": "openai-codex",      "authType": "oauth", "authenticated": false },
  { "id": "openai",            "authType": "apiKey", "authenticated": null },
  { "id": "google",            "authType": "apiKey", "authenticated": null },
  { "id": "xai",               "authType": "apiKey", "authenticated": null },
  { "id": "minimax",           "authType": "apiKey", "authenticated": null },
  { "id": "kimi-coding",       "authType": "apiKey", "authenticated": null }
]
```

---

### `POST /auth/token`

Get a valid API key for an OAuth provider. Automatically refreshes expired tokens and saves updated credentials to `auth.json`.

```bash
curl -X POST http://127.0.0.1:3456/auth/token \
  -H "Content-Type: application/json" \
  -d '{"providerId": "google-gemini-cli"}'
```

```json
{ "providerId": "google-gemini-cli", "apiKey": "..." }
```

> Returns `401` if the provider has never been logged in. Run `node ../ai/dist/cli.js login <providerId>` first.

---

### `POST /complete`

Run a non-streaming LLM completion. Returns the full `AssistantMessage` when done.

```bash
curl -X POST http://127.0.0.1:3456/complete \
  -H "Content-Type: application/json" \
  -d '{
    "model": {
      "id": "gemini-2.0-flash",
      "api": "google-gemini-cli",
      "provider": "google-gemini-cli",
      "baseUrl": "",
      "reasoning": false,
      "input": ["text"],
      "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
      "contextWindow": 1000000,
      "maxTokens": 8192
    },
    "context": {
      "messages": [{"role": "user", "content": "Hello!", "timestamp": 0}]
    },
    "options": { "apiKey": "<token from /auth/token>" }
  }'
```

```json
{
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello! How can I help you today?" }],
  "usage": { "input": 10, "output": 12, "totalTokens": 22, ... },
  "stopReason": "stop"
}
```

---

### `POST /stream`

Same request body as `/complete`. Returns a [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream.

Each SSE event carries an `AssistantMessageEvent` object. The stream ends with an `event: done` or `event: error` event.

```
event: message
data: {"type":"start","partial":{...}}

event: message
data: {"type":"text_delta","delta":"Hello","contentIndex":0,...}

event: done
data: {"type":"done","reason":"stop","message":{...}}
```

---

## Supported Providers

| Provider ID | Auth Type | Notes |
|-------------|-----------|-------|
| `google-gemini-cli` | OAuth | Free via Google account; run `login` first |
| `openai-codex` | OAuth | Requires ChatGPT Plus/Pro subscription |
| `openai` | API Key | Pass key in `options.apiKey` |
| `google` | API Key | Gemini API key |
| `xai` | API Key | Grok API key |
| `minimax` / `minimax-cn` | API Key | MiniMax API key |
| `kimi-coding` | API Key | Kimi API key |

---

## Python Example

A complete example using only Python's standard library (`urllib`) is available at [`examples/python_client.py`](examples/python_client.py).

```python
import json, urllib.request

# 1. Get OAuth token
req = urllib.request.Request(
    "http://127.0.0.1:3456/auth/token",
    data=json.dumps({"providerId": "google-gemini-cli"}).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req) as r:
    api_key = json.loads(r.read())["apiKey"]

# 2. Complete
req = urllib.request.Request(
    "http://127.0.0.1:3456/complete",
    data=json.dumps({
        "model": {
            "id": "gemini-2.0-flash", "api": "google-gemini-cli",
            "provider": "google-gemini-cli", "baseUrl": "",
            "reasoning": False, "input": ["text"],
            "cost": {"input":0,"output":0,"cacheRead":0,"cacheWrite":0},
            "contextWindow": 1000000, "maxTokens": 8192,
        },
        "context": {
            "messages": [{"role": "user", "content": "Hello!", "timestamp": 0}]
        },
        "options": {"apiKey": api_key},
    }).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req) as r:
    msg = json.loads(r.read())
    print(msg["content"][0]["text"])
```

---

## Development

```bash
# Watch mode
npm run dev

# Run directly (no build needed with tsx)
npx tsx src/server.ts
```
