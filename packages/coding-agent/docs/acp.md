# ACP Mode

ACP (Agent Client Protocol) mode allows pi to be used as an agent server, controlled via JSON-RPC over stdio. This enables integration with editors like Zed and other ACP-compatible clients.

## Usage

```bash
pi --mode acp
```

This starts pi as an ACP server that reads JSON-RPC requests from stdin and writes responses to stdout.

## Protocol

The implementation follows ACP protocol v1 using the `@agentclientprotocol/sdk` library. Communication uses newline-delimited JSON-RPC over stdio.

### Supported Methods

- **initialize** - Handshake with protocol version negotiation
- **session/new** - Create a new conversation session
- **session/load** - Resume an existing session (in-process only)
- **session/prompt** - Send a message to the agent
- **session/cancel** - Cancel an ongoing operation
- **session/set_model** - Change the active model
- **session/set_mode** - Change the session mode (no-op, pi doesn't have modes)

### Capabilities

The agent advertises these capabilities:

- `loadSession: true` - Sessions can be reloaded within the same process
- `promptCapabilities.embeddedContext: true` - Accepts embedded resource content
- `promptCapabilities.image: true` - Accepts image attachments

### Session Updates

During prompt execution, the agent sends `sessionUpdate` notifications:

- `agent_message_chunk` - Text output from the model
- `agent_thought_chunk` - Thinking/reasoning output (for models that support it)
- `tool_call` - Tool execution started
- `tool_call_update` - Tool execution progress/completion

## Testing

### Manual Testing

Test the ACP server by sending JSON-RPC messages:

```bash
# Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' | pi --mode acp

# Create session (use jq to parse the response and extract sessionId)
echo '{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"<abs-path>","mcpServers":[]}}' | pi --mode acp
```

### Interactive Testing

For interactive testing, run pi in ACP mode and send messages:

```bash
pi --mode acp
# Then type JSON-RPC requests, e.g.:
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}
```

## Editor Integration

### Zed

To use pi as an ACP agent in Zed, add to your settings:

```json
{
  "assistant": {
    "version": "2",
    "provider": {
      "name": "acp",
      "command": {
        "path": "pi",
        "args": ["--mode", "acp"]
      }
    }
  }
}
```

## Model Selection

Models are identified using the format `provider/model-id`, e.g.:

- `anthropic/claude-sonnet-4-20250514`
- `openai/gpt-4o`
- `google/gemini-2.0-flash`

Set the model via `session/set_model`:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/set_model",
  "params": {
    "sessionId": "<session-id>",
    "modelId": "anthropic/claude-sonnet-4-20250514"
  }
}
```

## Limitations

- Sessions are in-memory only (not persisted to disk in ACP mode). `--no-session` is effectively always on; `--session`, `--continue`, and `--resume` are ignored.
- No MCP (Model Context Protocol) server support
- Single-session-at-a-time for concurrent prompts (serialized execution)
- Authentication methods not implemented
- **No permission flow**: pi executes tools immediately without requesting user permission via `session/request_permission`. The ACP protocol allows agents to request permission before executing sensitive operations, but pi's design philosophy is to auto-execute all tool calls. Clients should be aware that tool execution begins immediately when a `tool_call` session update is received.
