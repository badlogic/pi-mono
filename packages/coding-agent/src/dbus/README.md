# Embry Agent D-Bus Service

A D-Bus session bus interface that exposes Pi's RPC mode as a system-level agent daemon.
Any UX surface — KDE launcher, Tauri desktop, voice pipeline, Stream Deck, 10ft view —
can invoke `org.embry.Agent.Ask()` without spawning subprocesses.

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  KDE/Tauri   │  │    Voice     │  │  Stream Deck │
│   Desktop    │  │   Pipeline   │  │   Plugin     │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └────────────┬────┘─────────────────┘
                    │ D-Bus Session Bus
                    │ org.embry.Agent
              ┌─────┴─────┐
              │  pi-dbus   │  ← bridge.ts
              │  (daemon)  │
              └─────┬─────┘
                    │ stdin/stdout JSON-lines
              ┌─────┴─────┐
              │  Pi RPC    │  ← existing rpc-client.ts
              │  (agent)   │
              └───────────┘
```

## Quick Start

### Install & Start

```bash
# Install the systemd user service
bash .pi/systemd/install.sh

# Start the daemon
systemctl --user start embry-agent

# Verify it's running
busctl --user call org.embry.Agent /org/embry/Agent org.embry.Agent Ping
```

### Using the ops skill

```bash
/ops-embry-agent status    # Check daemon status
/ops-embry-agent start     # Start daemon
/ops-embry-agent ping      # Health check
/ops-embry-agent logs 100  # View recent logs
```

## D-Bus Interface

**Bus name:** `org.embry.Agent`
**Object path:** `/org/embry/Agent`

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `Ask(s)→s` | prompt → response | Synchronous: blocks until agent completes |
| `AskAsync(s)→s` | prompt → requestId | Async: returns immediately, stream via signals |
| `Steer(s)` | instruction | Inject steering mid-conversation |
| `FollowUp(s)` | prompt | Continue the current conversation |
| `Abort()` | | Cancel current operation |
| `GetState()→s` | → JSON | Current agent state |
| `SetModel(ss)` | provider, model | Switch LLM provider/model |
| `RespondToUI(ss)` | requestId, JSON | Answer extension UI dialogs |
| `Ping()→s` | → "pong" + uptime | Health check |

### Signals

| Signal | Signature | Description |
|--------|-----------|-------------|
| `MessageUpdate(s)` | text delta | Streaming text from assistant |
| `ToolExecution(ss)` | tool, data JSON | Tool call start/update/end |
| `AgentEnd(s)` | result JSON | Conversation turn completed |
| `ExtensionUIRequest(ssss)` | id, type, title, body | Extension UI dialog request |
| `Ready()` | | Daemon ready to accept requests |
| `Error(s)` | message | Error occurred |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `IsStreaming` | boolean | Whether agent is currently responding |
| `CurrentModel` | string | Active model identifier |
| `SessionName` | string | Current session name |

## Python Client

```python
from common.embry_agent_client import EmbryAgentClient

async with EmbryAgentClient() as client:
    # Simple ask
    response = await client.ask("List all Python files")
    print(response)

    # Async with streaming
    request_id = await client.ask_async("Refactor auth module")
    async for event_type, data in client.stream_events():
        if event_type == "message_update":
            print(data, end="", flush=True)
```

## CLI

```bash
# Start the daemon directly (for development)
pi-dbus --cwd /path/to/project

# With specific model
pi-dbus --provider anthropic --model claude-sonnet-4-20250514
```

## Files

| File | Purpose |
|------|---------|
| `src/dbus/bridge.ts` | Core D-Bus ↔ RPC bridge |
| `src/dbus/interface.ts` | D-Bus introspection XML and constants |
| `src/dbus/types.ts` | Shared TypeScript types |
| `src/dbus/cli.ts` | CLI entry point (`pi-dbus` binary) |
| `.pi/systemd/embry-agent.service` | systemd user unit |
| `.pi/systemd/install.sh` | Install/uninstall helper |
| `.pi/skills/ops-embry-agent/` | Daemon management skill |
| `.pi/skills/common/embry_agent_client.py` | Python D-Bus client |
