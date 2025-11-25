# Mom Sandbox Implementation

## Overview

Mom uses [@anthropic-ai/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) to restrict what the bash tool can do at the OS level.

## Current Implementation

Located in `src/sandbox.ts`:

```typescript
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

const runtimeConfig: SandboxRuntimeConfig = {
  network: {
    allowedDomains: [], // Currently no network - should be ["*"] for full access
    deniedDomains: [],
  },
  filesystem: {
    denyRead: ["~/.ssh", "~/.aws", ...], // Sensitive paths
    allowWrite: [channelDir, scratchpadDir], // Only mom's folders
    denyWrite: [],
  },
};

await SandboxManager.initialize(runtimeConfig);
const sandboxedCommand = await SandboxManager.wrapWithSandbox(command);
```

## Key Limitation: Read Access

**Read is deny-only** - allowed everywhere by default. We can only deny specific paths, NOT allow only specific paths.

This means:
- ❌ Cannot say "only allow reads from channelDir and scratchpadDir"
- ✅ Can say "deny reads from ~/.ssh, ~/.aws, etc."

The bash tool CAN read files outside the mom data folder. We mitigate by denying sensitive directories.

## Write Access

**Write is allow-only** - denied everywhere by default. This works perfectly for our use case:
- Only `channelDir` and `scratchpadDir` can be written to
- Everything else is blocked

## Network Access

- `allowedDomains: []` = no network access
- `allowedDomains: ["*"]` = full network access
- `allowedDomains: ["github.com", "*.github.com"]` = specific domains

## How It Works

- **macOS**: Uses `sandbox-exec` with Seatbelt profiles
- **Linux**: Uses `bubblewrap` for containerization

The sandbox wraps commands - `SandboxManager.wrapWithSandbox("ls")` returns a modified command that runs inside the sandbox.

## Files

- `src/sandbox.ts` - Sandbox initialization and command wrapping
- `src/tools/bash.ts` - Uses `wrapCommand()` before executing

## Usage in Agent

```typescript
// In runAgent():
await initializeSandbox({ channelDir, scratchpadDir });
try {
  // ... run agent
} finally {
  await resetSandbox();
}
```

## TODO

1. **Update network config** - Change `allowedDomains: []` to `["*"]` for full network access
2. **Consider stricter read restrictions** - Current approach denies known sensitive paths but allows reads elsewhere
3. **Test on Linux** - Requires `bubblewrap` and `socat` installed

## Dependencies

macOS:
- `ripgrep` (brew install ripgrep)

Linux:
- `bubblewrap` (apt install bubblewrap)
- `socat` (apt install socat)
- `ripgrep` (apt install ripgrep)

## Reference

- [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)
- [Claude Code Sandboxing Docs](https://docs.claude.com/en/docs/claude-code/sandboxing)
