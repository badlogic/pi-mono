# Docker Sandbox Integration Guide

## Quick Start

The Docker sandbox has been successfully integrated into the Discord bot. Here's how to use it:

## Files Added

1. **`/opt/pi-mono/packages/discord-bot/src/sandbox.ts`** (12KB)
   - Core `DockerSandbox` class
   - Methods: `runPython()`, `runBash()`, `runNode()`
   - Automatic cleanup and resource management

2. **`/opt/pi-mono/packages/discord-bot/src/mcp-tools.ts`** (modified)
   - Added `sandbox_exec` MCP tool
   - Integrated with existing tool ecosystem
   - Available in `getAllMcpTools()`

3. **`/opt/pi-mono/packages/discord-bot/src/sandbox.test.ts`** (2.6KB)
   - Test suite for manual testing
   - Run with: `tsx src/sandbox.test.ts`

4. **`/opt/pi-mono/packages/discord-bot/examples/sandbox-usage.ts`** (4.2KB)
   - Comprehensive examples
   - Shows various use cases

5. **`/opt/pi-mono/packages/discord-bot/DOCKER_SANDBOX.md`** (7.5KB)
   - Full documentation
   - Security considerations
   - Troubleshooting guide

## Using the MCP Tool

The `sandbox_exec` tool is now available in Discord conversations. Claude can use it to execute code safely.

### Tool Parameters

```typescript
{
    label: string;      // Brief description (shown to user)
    language: string;   // "python", "bash", or "node"
    code: string;       // Code to execute
    timeout?: number;   // Timeout in seconds (default: 30, max: 120)
}
```

### Example Discord Usage

User: "Can you run this Python code for me?"

Claude can now use:
```typescript
sandbox_exec({
    label: "Running Python calculation",
    language: "python",
    code: "print(sum(range(1, 101)))",
    timeout: 10
})
```

The bot will respond with:
```
**Sandbox Execution (python)**

**Execution Time:** 245ms
**Exit Code:** 0

**Output:**
```
5050
```

_Executed in isolated container with network disabled, 256MB RAM, 0.5 CPU limit._
```

## Direct API Usage

You can also use the `DockerSandbox` class directly in your code:

```typescript
import { DockerSandbox } from "./sandbox.js";

async function example() {
    const sandbox = new DockerSandbox();

    // Execute Python
    const result = await sandbox.runPython('print("Hello!")', 30);
    console.log(result.output);

    // Execute Bash
    const bashResult = await sandbox.runBash('echo "Test"', 10);

    // Execute Node.js
    const nodeResult = await sandbox.runNode('console.log(process.version)', 15);

    // Cleanup on shutdown
    await sandbox.cleanupAll();
}
```

## Testing

### Prerequisites

1. Docker must be installed and running
2. Pull required images:
```bash
docker pull python:3.11-slim
docker pull node:20-slim
docker pull alpine:latest
```

### Run Tests

```bash
# Type check
npm run type-check

# Run test suite
tsx src/sandbox.test.ts

# Run examples
tsx examples/sandbox-usage.ts
```

## Security Features

### Resource Limits
- Memory: 256MB (Python/Node), 128MB (Bash)
- CPU: 0.5 cores
- Process limit: 50
- File descriptors: 100
- Network: **Disabled**

### Container Security
- No new privileges
- All capabilities dropped
- Read-only file mounts
- Automatic cleanup
- Timeout enforcement

### Safe by Default
- Default timeout: 30 seconds
- Maximum timeout: 120 seconds
- Isolated temp directories
- No host filesystem access
- No network access

## Comparison with Old Tool

| Feature | `docker_sandbox` | `sandbox_exec` |
|---------|------------------|----------------|
| Class-based | ❌ | ✅ |
| Cleanup | ❌ | ✅ Automatic |
| Exit codes | ❌ | ✅ |
| Execution time | ❌ | ✅ |
| Type safety | ❌ | ✅ |
| Read-only mounts | ❌ | ✅ |
| Testable | ❌ | ✅ |

## Integration Points

### 1. MCP Tools Array
The tool is registered in `getAllMcpTools()`:
```typescript
// Docker Sandbox
createDockerSandboxTool(),
createSandboxExecTool(),  // Enhanced Docker sandbox with resource management
```

### 2. Tool Schema
```typescript
const sandboxExecSchema = Type.Object({
    label: Type.String({ description: "Brief description (shown to user)" }),
    language: Type.String({ description: "Programming language: python, bash, node" }),
    code: Type.String({ description: "Code to execute" }),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30, max: 120)" })),
});
```

### 3. Execution Flow
1. User asks Claude to run code
2. Claude calls `sandbox_exec` tool
3. Tool creates `DockerSandbox` instance
4. Code executes in isolated container
5. Results returned to Claude
6. Claude presents results to user
7. Container auto-cleaned

## Error Handling

The sandbox handles errors gracefully:

### Timeout
```typescript
{
    output: "(partial output)",
    error: "Execution timed out after 30 seconds",
    exitCode: 124,
    executionTime: 30000
}
```

### Runtime Error
```typescript
{
    output: "Traceback (most recent call last)...",
    error: "ZeroDivisionError: division by zero",
    exitCode: 1,
    executionTime: 156
}
```

### Image Not Found
```typescript
{
    output: "",
    error: "Failed to pull Docker image python:3.11-slim: ...",
    exitCode: 1,
    executionTime: 245
}
```

## Monitoring

### Check for Orphaned Containers
```bash
docker ps -a --filter "name=sandbox-"
```

### Clean Up Manually
```bash
# Remove containers
docker rm -f $(docker ps -a --filter "name=sandbox-" -q)

# Remove temp files
rm -rf /tmp/discord-bot-sandbox/
```

### Monitor Resource Usage
```bash
# Watch running containers
docker stats

# Check disk usage
du -sh /tmp/discord-bot-sandbox/
```

## Troubleshooting

### Docker Not Running
```bash
sudo systemctl start docker
sudo systemctl enable docker
```

### Permission Denied
```bash
sudo usermod -aG docker $USER
newgrp docker
```

### Images Not Found
```bash
docker pull python:3.11-slim
docker pull node:20-slim
docker pull alpine:latest
```

### TypeScript Errors
```bash
# Check syntax
npx tsc --noEmit --skipLibCheck

# Build project
npm run build
```

## Next Steps

### Recommended Enhancements
1. Add rate limiting per user
2. Add audit logging for code execution
3. Implement content filtering for malicious patterns
4. Add support for more languages (Rust, Go, Ruby)
5. Enable package installation (pip, npm) in sandboxed way
6. Add streaming output for long-running tasks
7. Implement resource usage tracking
8. Add custom Docker images per user/guild

### Optional Features
- Persistent workspace between executions
- Multi-file execution support
- GPU support for ML workloads
- Collaborative code execution
- Code snippet library
- Execution history

## Contributing

To modify the sandbox:

1. Edit `/opt/pi-mono/packages/discord-bot/src/sandbox.ts`
2. Update tests in `src/sandbox.test.ts`
3. Run `npm run type-check`
4. Test with `tsx src/sandbox.test.ts`
5. Update documentation

## Support

For issues or questions:
1. Check `DOCKER_SANDBOX.md` for detailed docs
2. Review examples in `examples/sandbox-usage.ts`
3. Run test suite to verify setup
4. Check Docker daemon status

## License

Same as parent project (MIT)
