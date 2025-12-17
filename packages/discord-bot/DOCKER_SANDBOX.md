# Docker Sandbox for Code Execution

This document describes the Docker sandbox implementation for secure code execution in the Discord bot.

## Overview

The Docker sandbox provides isolated execution environments for running untrusted code with strict resource limits and security controls. It supports three languages:
- **Python** (3.11)
- **Node.js** (20)
- **Bash/Shell** (Alpine Linux)

## Architecture

### Files

- **`src/sandbox.ts`**: Core `DockerSandbox` class implementation
- **`src/mcp-tools.ts`**: Integration with MCP tools (`sandbox_exec` tool)
- **`src/sandbox.test.ts`**: Test suite for manual testing

### DockerSandbox Class

The `DockerSandbox` class provides three main methods:

#### `runPython(code: string, timeout?: number): Promise<ExecutionResult>`
Executes Python code in an isolated container using the `python:3.11-slim` image.

#### `runBash(command: string, timeout?: number): Promise<ExecutionResult>`
Executes Bash commands in an isolated container using the `alpine:latest` image.

#### `runNode(code: string, timeout?: number): Promise<ExecutionResult>`
Executes Node.js code in an isolated container using the `node:20-slim` image.

### ExecutionResult Interface

```typescript
interface ExecutionResult {
    output: string;        // stdout from execution
    error?: string;        // stderr or error message
    exitCode?: number;     // process exit code
    executionTime: number; // execution time in milliseconds
}
```

## Security Features

### Resource Limits

All containers run with strict resource constraints:
- **Memory**: 256MB (128MB for Alpine/Bash)
- **CPU**: 0.5 cores
- **Process limit**: 50 processes max
- **File descriptors**: 100 max
- **Network**: Disabled (`--network=none`)

### Container Security

- **No new privileges**: `--security-opt=no-new-privileges`
- **Drop all capabilities**: `--cap-drop=ALL`
- **Read-only mounts**: Code files mounted as read-only (`:ro`)
- **Temporary storage**: Each execution uses isolated temp directory
- **Auto-cleanup**: Containers removed after execution (`--rm`)

### Timeout Protection

- Default timeout: 30 seconds
- Maximum timeout: 120 seconds
- Forced container termination on timeout
- Cleanup of lingering containers

## Usage

### Direct Usage

```typescript
import { DockerSandbox } from "./sandbox.js";

const sandbox = new DockerSandbox();

// Run Python code
const result = await sandbox.runPython('print("Hello!")', 30);
console.log(result.output);

// Run Bash command
const bashResult = await sandbox.runBash('echo "Test"', 10);

// Run Node.js code
const nodeResult = await sandbox.runNode('console.log("Hi")', 15);

// Cleanup (on shutdown)
await sandbox.cleanupAll();
```

### MCP Tool Usage

The `sandbox_exec` MCP tool is available in Discord conversations:

```
Use the sandbox_exec tool to execute code:
- language: "python", "bash", or "node"
- code: the code to execute
- timeout: timeout in seconds (default: 30, max: 120)
```

Example:
```typescript
{
    label: "Test Python code",
    language: "python",
    code: "print('Hello, World!')",
    timeout: 10
}
```

## Implementation Details

### Execution Flow

1. **Validation**: Timeout is clamped to safe range (1-120 seconds)
2. **Image Check**: Verify Docker image exists, pull if needed
3. **Temp Directory**: Create isolated temp directory for execution
4. **File Creation**: Write code to file in temp directory
5. **Container Run**: Execute code in Docker container with security limits
6. **Result Capture**: Capture stdout, stderr, exit code, and timing
7. **Cleanup**: Remove temp directory and force-remove container

### Error Handling

- **Image pull failures**: Graceful error reporting
- **Execution errors**: Capture stderr and exit codes
- **Timeouts**: Forced container stop with timeout exit code (124)
- **Cleanup failures**: Silent ignore to prevent cascading errors

### File Management

- Temp directory: `/tmp/discord-bot-sandbox/` (or system temp)
- Each execution gets unique subdirectory: `sandbox-{lang}-{uuid}`
- Code files: `script.py`, `script.js`, or `script.sh`
- Auto-cleanup after execution

## Testing

### Manual Testing

Run the test suite:

```bash
tsx src/sandbox.test.ts
```

This tests:
1. Python execution
2. Bash execution
3. Node.js execution
4. Error handling
5. Timeout handling

### Prerequisites

Ensure Docker is installed and running:

```bash
docker --version
docker pull python:3.11-slim
docker pull node:20-slim
docker pull alpine:latest
```

## Configuration

### Custom Temp Directory

```typescript
const sandbox = new DockerSandbox("/custom/temp/path");
```

### Custom Resource Limits

Modify the `runContainer` method parameters:

```typescript
options: {
    memory: "512m",    // increase memory
    cpus: "1.0",       // increase CPU
    network: true,     // enable network (NOT RECOMMENDED)
}
```

## Monitoring

### Container Cleanup

Check for lingering containers:

```bash
docker ps -a --filter "name=sandbox-"
```

Clean up manually:

```bash
docker rm -f $(docker ps -a --filter "name=sandbox-" -q)
```

### Temp Directory Cleanup

Check temp directory size:

```bash
du -sh /tmp/discord-bot-sandbox/
```

Clean up manually:

```bash
rm -rf /tmp/discord-bot-sandbox/
```

## Troubleshooting

### "Cannot connect to Docker daemon"

Ensure Docker is running:

```bash
sudo systemctl start docker
```

### "Permission denied"

Add user to docker group:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### "Image not found"

Pull required images:

```bash
docker pull python:3.11-slim
docker pull node:20-slim
docker pull alpine:latest
```

### Timeout not working

Ensure container name is unique and cleanup is working. Check for orphaned containers.

## Comparison with Existing `docker_sandbox` Tool

| Feature | `docker_sandbox` (old) | `sandbox_exec` (new) |
|---------|------------------------|---------------------|
| Implementation | Inline in mcp-tools.ts | Dedicated DockerSandbox class |
| File Management | Inline shell execution | Proper temp directory management |
| Cleanup | None | Automatic cleanup with cleanup() |
| Error Handling | Basic | Comprehensive with proper types |
| Timeout | Basic | Forced container termination |
| Resource Limits | Yes | Yes + enhanced security |
| Read-only Mounts | No | Yes |
| Exit Codes | No | Yes |
| Execution Time | No | Yes (milliseconds) |
| Testability | Hard | Easy with test suite |

## Future Enhancements

Potential improvements:
- Support for more languages (Rust, Go, Ruby, etc.)
- Custom Docker images per user
- Persistent storage between executions
- Network access with firewall rules
- GPU support for ML workloads
- Resource usage metrics (CPU, memory)
- Multi-file execution
- Package installation (pip, npm)
- Streaming output for long-running tasks

## Security Considerations

### What's Protected

- Host system isolated from container
- Network access disabled
- Resource limits prevent DoS
- Automatic cleanup prevents disk exhaustion
- Read-only mounts prevent code modification
- Capability dropping prevents privilege escalation

### What's Not Protected

- Docker daemon vulnerabilities
- Kernel vulnerabilities
- Side-channel attacks
- Time-based inference attacks
- Docker escape vulnerabilities

### Best Practices

1. **Keep Docker updated**: Regular security patches
2. **Monitor resource usage**: Prevent abuse
3. **Rate limiting**: Limit executions per user
4. **Audit logs**: Track who runs what code
5. **Content filtering**: Block malicious patterns
6. **User education**: Explain security boundaries

## License

Same as parent project (MIT)
