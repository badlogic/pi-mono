# MCP Extension for Pi

Adds [Model Context Protocol](https://modelcontextprotocol.io/) support to pi, enabling connection to MCP servers for additional tools and resources.

## Features

- **Stdio transport**: Connect to local MCP servers via subprocess
- **SSE transport**: Connect to remote MCP servers via Server-Sent Events
- **Dynamic tool registration**: MCP tools are automatically registered with pi
- **TUI management**: `/mcp` command for server management
- **Status indicator**: Footer shows connection status

## Installation

```bash
# From the extensions directory
cd ~/.pi/agent/extensions
mkdir mcp
cd mcp

# Copy the extension files
cp /path/to/pi-mono/packages/coding-agent/examples/extensions/mcp/* .

# Install dependencies
npm install
```

Or symlink for development:
```bash
ln -s /path/to/pi-mono/packages/coding-agent/examples/extensions/mcp ~/.pi/agent/extensions/mcp
cd ~/.pi/agent/extensions/mcp
npm install
```

## Usage

### Managing Servers

Use the `/mcp` command to open the server management UI:

```
/mcp
```

From there you can:
- View connected servers and their status
- Add new servers (stdio or SSE)
- Connect/disconnect servers
- View available tools
- Test connections
- Remove servers

### Configuration

Servers can also be configured in `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
        "enabled": true
      },
      "github": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_TOKEN": "${GITHUB_TOKEN}"
        },
        "enabled": true
      },
      "remote-api": {
        "type": "sse",
        "url": "https://api.example.com/mcp",
        "headers": {
          "Authorization": "Bearer ${API_KEY}"
        },
        "enabled": true
      }
    }
  }
}
```

### Environment Variables

Use `${VAR_NAME}` syntax in configuration to reference environment variables:

```json
{
  "env": {
    "API_KEY": "${MY_API_KEY}"
  }
}
```

### Using MCP Tools

Once connected, MCP tools are available to the LLM with the prefix `mcp_<server>_<tool>`:

```
# If "filesystem" server provides "read_file" tool:
# It becomes: mcp_filesystem_read_file
```

The LLM will see these tools in its available tool list and can call them automatically based on your requests.

## Server Types

### Stdio (Local)

Runs a local command as a subprocess:

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "env": { "CUSTOM_VAR": "value" },
  "enabled": true
}
```

### SSE (Remote)

Connects to a remote server via Server-Sent Events:

```json
{
  "type": "sse",
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${TOKEN}"
  },
  "enabled": true
}
```

## Popular MCP Servers

| Server | Command | Description |
|--------|---------|-------------|
| Filesystem | `npx -y @modelcontextprotocol/server-filesystem /path` | File read/write operations |
| GitHub | `npx -y @modelcontextprotocol/server-github` | GitHub API access |
| Postgres | `npx -y @modelcontextprotocol/server-postgres` | PostgreSQL queries |
| Brave Search | `npx -y @anthropic/mcp-server-brave-search` | Web search |

See [MCP Servers](https://github.com/modelcontextprotocol/servers) for more options.

## Status Indicator

The footer shows MCP status:
- `● MCP 2/2` - All servers connected (green)
- `◐ MCP 1/2` - Some servers connected (yellow)
- `○ MCP 0/2` - No servers connected (dim)

## Troubleshooting

### Server won't connect

1. Check the command works manually:
   ```bash
   npx -y @modelcontextprotocol/server-filesystem /tmp
   ```

2. Check environment variables are set:
   ```bash
   echo $GITHUB_TOKEN
   ```

3. View server error in `/mcp` UI

### Tools not appearing

1. Verify server is connected (green dot in `/mcp`)
2. Some servers require initialization before exposing tools
3. Check server logs for errors

### SSE connection issues

1. Verify URL is accessible
2. Check CORS headers if browser-based
3. Ensure authentication headers are correct
