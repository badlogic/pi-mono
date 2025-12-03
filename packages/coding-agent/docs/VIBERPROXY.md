# VibeProxy Integration

The Pi Coding Agent now includes native support for [VibeProxy](https://github.com/automazeio/vibeproxy), a macOS application that provides local proxy access to Claude Code and ChatGPT subscriptions.

## What is VibeProxy?

VibeProxy is a native macOS menu bar application that:
- Runs locally on your Mac (port 8318 by default)
- Provides OpenAI-compatible API endpoints 
- Routes requests through your Claude Code or ChatGPT subscriptions
- Eliminates the need for separate API keys
- Works with various AI tools and coding assistants

## Automatic Detection

The Pi Coding Agent automatically detects running VibeProxy instances and makes available models appear as first-class citizens:

```bash
# Start Pi (auto-detects VibeProxy)
pi --provider vibeproxy --model claude-sonnet-4-20250514 "Hello, world!"
```

### Available VibeProxy Models

When VibeProxy is running, the following models are automatically available:

| Model | Reasoning | Max Tokens | Description |
|-------|-----------|------------|-------------|
| `claude-sonnet-4-20250514` | ❌ | 8192 | Claude Sonnet 4 |
| `claude-opus-4-20250514` | ✅ | 4096 | Claude Opus 4 |
| `claude-3-5-sonnet-20250219` | ❌ | 8192 | Claude 3.5 Sonnet |
| `gpt-5.1-codex` | ❌ | 8192 | GPT-5.1 Codex |

*Additional models detected by VibeProxy will also be available automatically.*

## Setup

### 1. Install VibeProxy

```bash
# Clone and build VibeProxy
git clone https://github.com/automazeio/vibeproxy.git
cd vibeproxy
npm install && npm run build
```

Or download the latest release from the [VibeProxy releases](https://github.com/automazeio/vibeproxy/releases) page.

### 2. Start VibeProxy

Launch VibeProxy and ensure it's running. The menu bar icon should be visible, and the proxy should be accessible on `http://localhost:8318`.

### 3. Configure VibeProxy

In VibeProxy settings:
- Configure your Claude Code or ChatGPT subscription
- Ensure the proxy is enabled
- Verify it's running on the default port (8318)

### 4. Start Pi

Pi will automatically detect VibeProxy:

```bash
# List all available models (includes VibeProxy)
pi --models

# Use a VibeProxy model
pi --provider vibeproxy --model claude-sonnet-4-20250514
```

## Manual Configuration

If auto-detection doesn't work, or you want to use a custom VibeProxy setup, you can manually configure it:

### Configuration File

Create `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "vibeproxy": {
      "baseUrl": "http://localhost:8318/v1",
      "apiKey": "dummy",
      "api": "openai-completions",
      "models": [
        {
          "id": "claude-sonnet-4-20250514",
          "name": "Claude Sonnet 4 (via VibeProxy)",
          "api": "openai-completions",
          "reasoning": false,
          "input": ["text"],
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          },
          "contextWindow": 200000,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

### Environment Variables

```bash
# Custom port (if not using default 8318)
export VIBEPROXY_PORT=8319

# Custom host (if running on different machine)
export VIBEPROXY_HOST=192.168.1.100
```

## Troubleshooting

### VibeProxy Not Detected

1. **Check if VibeProxy is running**:
   ```bash
   curl http://localhost:8318/
   ```

2. **Check the correct port**:
   ```bash
   netstat -an | grep 8318
   ```

3. **Restart Pi after starting VibeProxy**:
   ```bash
   pi --provider vibeproxy --model claude-sonnet-4-20250514 --print "test"
   ```

### Connection Errors

1. **Verify VibeProxy endpoints**:
   ```bash
   # Test basic endpoint
   curl http://localhost:8318/
   
   # Test models endpoint
   curl http://localhost:8318/v1/models
   ```

2. **Check VibeProxy logs** through the menu bar application

3. **Ensure subscription is active** in VibeProxy settings

### Model Not Available

1. **List available models**:
   ```bash
   pi --provider vibeproxy --models
   pi --print | jq '.data[].id'
   ```

2. **Check VibeProxy model access** through the VibeProxy interface

3. **Verify subscription** covers the requested model

## Benefits of VibeProxy Integration

- **No API Keys Required**: Use your existing Claude Code/ChatGPT subscriptions
- **Auto-Discovery**: Models appear automatically when VibeProxy is running
- **Cost Tracking**: Usage tracked through your subscription billing
- **Seamless Integration**: Works exactly like built-in providers
- **Privacy All**: Requests stay local until sent through your subscription

## Advanced Configuration

### Custom Base URL

If VibeProxy is running on a different port or host:

```json
{
  "providers": {
    "vibeproxy": {
      "baseUrl": "http://localhost:8319/v1",
      "apiKey": "dummy",
      "api": "openai-completions",
      "models": [...]
    }
  }
}
```

### Custom Headers

Add custom headers for VibeProxy:

```json
{
  "providers": {
    "vibeproxy": {
      "baseUrl": "http://localhost:8318/v1",
      "apiKey": "dummy",
      "api": "openai-completions",
      "headers": {
        "X-Custom-Header": "value"
      },
      "models": [...]
    }
  }
}
```

## Development

### Testing VibeProxy Integration

The test suite includes comprehensive VibeProxy testing:

```bash
# Run VibeProxy-specific tests
npm test -- vibeproxy

# Run integration tests
npm test -- model-config-vibeproxy
```

### Mock VibeProxy for Testing

To test without a real VibeProxy instance, the tests include comprehensive mocking:

```typescript
// Mock VibeProxy detection
vi.mock("../vibeproxy.js", () => ({
  detectVibeProxy: vi.fn().mockResolvedValue({
    running: true,
    port: 8318,
    models: [{ id: "claude-sonnet-4-20250514" }]
  })
}));
```

## Contributing

To contribute to VibeProxy integration:

1. Fork the [pi-mono repository](https://github.com/badlogic/pi-mono)
2. Create a feature branch: `git checkout -b vibeproxy-enhancement`
3. Add tests for new functionality
4. Ensure all tests pass: `npm run test && npm run check`
5. Submit a pull request

## Support

- **Pi Issues**: [pi-mono GitHub Issues](https://github.com/badlogic/pi-mono/issues)
- **VibeProxy Issues**: [vibeproxy GitHub Issues](https://github.com/automazeio/vibeproxy/issues)
- **Discussion**: Join the [Pi Discord](https://discord.gg/picodingagent) for community support
