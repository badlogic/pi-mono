# Extension Examples Gallery

Real-world extensions demonstrating common patterns.

## Safety & Permissions

| Example | Description |
|---------|-------------|
| `permission-gate` | Confirm before dangerous bash commands (rm -rf, sudo) |
| `protected-paths` | Block writes to .env, .git/, node_modules/ |
| `confirm-destructive` | Confirm destructive session actions (clear, fork) |
| `dirty-repo-guard` | Prevent session changes with uncommitted git changes |

## Custom Tools

| Example | Description |
|---------|-------------|
| `todo` | Todo list tool with state persistence |
| `hello` | Minimal custom tool example |
| `truncated-tool` | Ripgrep wrapper with output truncation |
| `ssh` | Delegate all tools to remote machine via SSH |
| `antigravity-image-gen` | Generate images via Google Antigravity |

## Commands & UI

| Example | Description |
|---------|-------------|
| `plan-mode/` | Read-only exploration mode with `/plan` |
| `tools` | Interactive `/tools` command to enable/disable tools |
| `handoff` | Transfer context to new focused session |
| `status-line` | Turn progress in footer |
| `widget-placement` | Widgets above/below editor |
| `snake` | Snake game with custom UI |
| `doom-overlay/` | DOOM game at 35 FPS overlay |

## Git Integration

| Example | Description |
|---------|-------------|
| `git-checkpoint` | Stash checkpoints at each turn |
| `auto-commit-on-exit` | Auto-commit on exit |

## System Prompt & Compaction

| Example | Description |
|---------|-------------|
| `claude-rules` | Scan .claude/rules/ and list in system prompt |
| `custom-compaction` | Summarize entire conversation |
| `trigger-compact` | Auto-compact at 100k tokens |

## Messages & Communication

| Example | Description |
|---------|-------------|
| `message-renderer` | Custom message rendering with colors |
| `event-bus` | Inter-extension communication |

## Session Metadata

| Example | Description |
|---------|-------------|
| `session-name` | Name sessions for session selector |
| `bookmark` | Bookmark entries with labels |

## Custom Providers

| Example | Description |
|---------|-------------|
| `custom-provider-anthropic/` | Anthropic provider with OAuth |
| `custom-provider-gitlab-duo/` | GitLab Duo via proxy |
| `custom-provider-qwen-cli/` | Qwen CLI with OAuth device flow |

## Running Examples

```bash
# Load an extension directly
pi -e ./packages/coding-agent/examples/extensions/hello.ts

# Or copy to extensions directory
cp packages/coding-agent/examples/extensions/hello.ts ~/.pi/agent/extensions/
```

## See Also

- [examples/README.md](../../packages/coding-agent/examples/extensions/README.md) - Full catalog with descriptions
- [Extension Source Code](../../packages/coding-agent/examples/extensions/) - Reference implementations
