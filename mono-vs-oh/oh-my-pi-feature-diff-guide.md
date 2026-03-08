# `oh-my-pi/packages` vs `pi-mono/packages` - Comprehensive Feature Comparison

This guide provides a detailed comparison of features between `pi-guide/oh-my-pi/packages` and `packages` in the pi-mono repository.

## Scope Rules

- Only compared files under `pi-guide/oh-my-pi/packages` and `packages`
- Used package READMEs, `package.json`, and source-tree contents
- Did not count root-level tooling, CI, or non-package folders
- Only called something a missing feature when there was a concrete subsystem in one tree and no equivalent in the other

---

## At a Glance

### Shared Package Names

| Package | Status |
|---------|--------|
| `agent` | Shared |
| `ai` | Shared |
| `coding-agent` | Shared |
| `stats` | Shared |
| `tui` | Shared |

### Packages Only in `oh-my-pi`

| Package | Description |
|---------|-------------|
| `natives` | Native Rust bindings via N-API (grep, find, image, clipboard, PTY, etc.) |
| `swarm-extension` | YAML-defined multi-agent orchestration with DAG execution |
| `react-edit-benchmark` | Benchmark harness for code edits against React source mutations |
| `utils` | Shared utilities (CLI, logger, process manager, async/stream helpers) |

### Packages Only in `pi-mono`

| Package | Description |
|---------|-------------|
| `mom` | Slack bot with self-managing tools, skills, and Docker sandbox execution |
| `pods` | CLI for deploying and managing vLLM on GPU pods (DataCrunch, RunPod, etc.) |
| `web-ui` | Reusable web UI components for AI chat interfaces with mini-lit and Tailwind |

---

## Source LOC Comparison (Shared Packages)

| Package | `pi-mono` | `oh-my-pi` | Delta |
|---------|----------:|----------:|------:|
| `coding-agent` | 212,577 | 179,131 | `pi-mono +33,446` |
| `ai` | 130,587 | 62,715 | `pi-mono +67,872` |
| `agent` | 65,125 | 3,443 | `pi-mono +61,682` |
| `tui` | 27,429 | 16,067 | `pi-mono +11,362` |

> **Note**: `pi-mono` is larger overall, but `oh-my-pi` has several package-level capabilities that `pi-mono` does not ship.

---

## Package-by-Package Differences

### `agent`

Both packages provide stateful agent runtime with tool execution and event streaming.

**Conclusion**: No clear `oh-my-pi`-only feature confirmed from package contents. The `pi-mono` README surface is actually broader in some areas (separate `steeringMode`, `followUpMode`, `sessionId`, `thinkingBudgets`).

---

### `ai` - LLM Provider Abstraction

`oh-my-pi` has a significantly broader provider/discovery/accounting surface.

#### Providers Only in `oh-my-pi`

| Provider | Description |
|----------|-------------|
| Together | Together AI API |
| Moonshot | Moonshot AI |
| Qianfan | Baidu Qianfan |
| NVIDIA | NVIDIA NIM API |
| NanoGPT | NanoGPT API |
| Hugging Face Inference | HF Inference Endpoints |
| Venice | Venice AI |
| Kilo Gateway | Kilo.ai Gateway |
| LiteLLM | LiteLLM proxy |
| zAI | zAI API |
| MiniMax Coding Plan | MiniMax coding models |
| Xiaomi MiMo | Xiaomi MiMo models |
| Qwen Portal | Qwen Portal API |
| Cloudflare AI Gateway | CF Workers AI |
| Ollama | Local Ollama |
| vLLM | vLLM deployments |

#### `oh-my-pi`-Only Source Subsystems

**Dedicated Provider Modules** (not in `pi-mono`):
- `src/providers/cursor.ts` - Cursor IDE integration
- `src/providers/gitlab-duo.ts` - GitLab Duo integration
- `src/providers/kimi.ts` - Kimi AI integration
- `src/providers/synthetic.ts` - Synthetic/mock provider for testing
- `src/providers/google-gemini-cli-usage.ts` - Usage tracking for Gemini CLI

**Provider/Model Metadata System**:
- `src/model-cache.ts` - Model caching
- `src/model-manager.ts` - Model management
- `src/provider-details.ts` - Provider metadata
- `src/provider-models/*` - Per-provider model configurations
  - `descriptors.ts`
  - `google.ts`
  - `index.ts`
  - `model-policies.ts`
  - `openai-compat.ts`
  - `special.ts`
- Published `src/models.json`

**Usage Accounting Modules**:
- `src/usage.ts` - Usage tracking entry point
- `src/usage/claude.ts`
- `src/usage/github-copilot.ts`
- `src/usage/google-antigravity.ts`
- `src/usage/kimi.ts`
- `src/usage/minimax-code.ts`
- `src/usage/openai-codex.ts`
- `src/usage/zai.ts`

**OAuth and Provider Discovery Adapters** (`src/utils/oauth/*`):
- `cerebras.ts`, `cloudflare-ai-gateway.ts`, `cursor.ts`
- `gitlab-duo.ts`, `huggingface.ts`, `kagi.ts`, `kilo.ts`
- `kimi.ts`, `litellm.ts`, `lm-studio.ts`, `minimax-code.ts`
- `moonshot.ts`, `nanogpt.ts`, `nvidia.ts`, `ollama.ts`
- `opencode.ts`, `perplexity.ts`, `qianfan.ts`, `qwen-portal.ts`
- `synthetic.ts`, `together.ts`, `venice.ts`, `vllm.ts`
- `xiaomi.ts`, `zai.ts`

**Provider Discovery** (`src/utils/discovery/*`):
- `antigravity.ts`, `codex.ts`, `cursor.ts`, `gemini.ts`
- `index.ts`, `openai-compatible.ts`

**Schema Compatibility Helpers** (`src/utils/schema/*`):
- `adapt.ts`, `compatibility.ts`, `dereference.ts`
- `equality.ts`, `fields.ts`, `index.ts`
- `normalize-cca.ts`, `sanitize-google.ts`, `strict-mode.ts`, `types.ts`

**Additional Utilities**:
- `src/rate-limit-utils.ts`
- `src/utils/retry-after.ts`
- `src/utils/retry.ts`
- `src/utils/http-inspector.ts`
- `src/utils/tool-choice.ts`

#### What `pi-mono` Has

`pi-mono` has a focused set of providers:
- Amazon Bedrock
- Anthropic
- Azure OpenAI
- GitHub Copilot
- Google (Gemini, Vertex, Gemini CLI)
- OpenAI (Completions, Responses, Codex)

---

### `coding-agent` - Interactive Agent CLI

This is the largest feature gap area. `oh-my-pi` has a more extensive multi-command CLI with many subsystems. `pi-mono` has been expanding its CLI architecture.

#### CLI Commands Comparison

**Commands Only in `oh-my-pi`:**

| Command | Description |
|---------|-------------|
| `commit` | Agentic commit generation |
| `grep` | Built-in grep command |
| `jupyter` | Jupyter integration |
| `plugin` | Plugin management |
| `setup` | Initial setup wizard |
| `shell` | Interactive shell mode |
| `update` | Self-update command |
| `search` / `q` | Web search integration |

**Commands Now in Both:**

| Command | Description |
|---------|-------------|
| `agents` | Subagent management (pi-mono: list discovered agents) |
| `ssh` | SSH integration (pi-mono: config management) |
| `stats` | Statistics dashboard |
| `config` | Configuration management |

**pi-mono CLI Architecture (New):**

`pi-mono/packages/coding-agent/src/cli.ts` now uses a command router:

```typescript
import { runCli } from "./cli/command-router.js";
void runCli(process.argv.slice(2));
```

**Evidence**: `pi-mono/packages/coding-agent/src/cli/command-router.ts` provides command resolution with handler injection for testing.

#### `oh-my-pi`-Only Subsystems

**Async Job Subsystem** (`src/async/*`):
- Background job management and tracking

**Capability Model** (`src/capability/*`):
- `context-files.ts` - Context file management
- `extensions.ts` - Extension capabilities
- `hooks.ts` - Hook system
- `mcp.ts` - Model Context Protocol
- `prompts.ts` - Prompt management
- `rules.ts` - Rule system
- `settings.ts` - Settings capabilities
- `skills.ts` - Skill system
- `slash-commands.ts` - Slash command capabilities
- `ssh.ts` - SSH capabilities
- `system-prompt.ts` - System prompt capabilities
- `tools.ts` - Tool capabilities

**Commit Automation Stack** (`src/commit/*`):
- Agentic commit generation
- Changelog helpers
- Git analysis
- Split-commit tooling

**Rich Command Implementations** (`src/commands/*`):
- Individual command handlers for CLI commands

**Config and Discovery** (`src/config/*`, `src/discovery/*`):
- Advanced configuration management
- Provider/service discovery

**Search / Web / Exa** (`src/web/*`, `src/exa/*`):
- Web search integration
- Exa search API integration

**External Integrations**:
- `src/mcp/*` - Model Context Protocol
- `src/lsp/*` - Language Server Protocol
- `src/ssh/*` - SSH integration
- `src/ipy/*` - IPython/Jupyter integration
- `src/stt/*` - Speech-to-text

**Memory and Planning**:
- `src/memories/*` - Persistent memory system
- `src/plan-mode/*` - Plan mode implementation

**Patch and Export**:
- `src/patch/*` - Patch application system
- `src/export/*` - Export functionality

**Extensibility Surface** (`src/extensibility/*`):
- `custom-commands/*` - Custom command creation
- `custom-tools/*` - Custom tool creation
- `extensions/*` - Extension system
- `hooks/*` - Hook system
- `plugins/*` - Plugin system

**Other**:
- `src/slash-commands/*` - Dedicated slash commands
- `src/task/*` - Task executor subsystem
- `src/secrets/*` - Secret management
- `src/cursor.ts` - Cursor IDE integration
- `src/internal-urls/*` - Internal URL handling

#### What `pi-mono` Has

`pi-mono` has a focused structure with recent expansions:
- `core/*` - Core agent functionality
  - `agent-session.ts`, `bash-executor.ts`, `compaction/`
  - `event-bus.ts`, `extensions/`, `model-registry.ts`
  - `session-manager.ts`, `settings-manager.ts`, `subagents/`
  - `tools/` (bash, read, write, edit, grep, find, ls, etc.)
- `modes/*` - Interactive, print, and RPC modes
- `addons-extensions/` - Additional extensions
- `utils/` - Utility functions
- `cli/*` - **NEW**: Command router and CLI commands
  - `command-router.ts` - Command resolution
  - `agents-command.ts` - List subagents
  - `ssh-command.ts` - SSH config management
  - `ssh-config.ts` - SSH config file utilities

**Recent pi-mono Additions (2026-03-06):**
- Multi-command CLI architecture
- SSH host configuration management
- Stats dashboard integration
- Agents listing command
- Tool execution duration tracking
- Streaming UI buffering (33ms throttle)
- Status line tool stats segments

**pi-mono still lacks**:
- Commit automation package surface
- Plugin subsystem
- LSP / Jupyter / web-search command surfaces
- MCP integration
- Memory system
- Plan mode

---

### `tui` - Terminal UI Library

Both have capable TUI libraries with different strengths.

#### `oh-my-pi`-Only Modules

| Module | Description |
|--------|-------------|
| `src/bracketed-paste.ts` | Bracketed paste mode handling |
| `src/components/tab-bar.ts` | Tab bar component |
| `src/symbols.ts` | Terminal symbols |
| `src/terminal-capabilities.ts` | Terminal capability detection |
| `src/ttyid.ts` | TTY identification |

#### `pi-mono` Strengths

- Overlays and overlay system
- IME cursor support
- Different component set optimized for coding agent use

**Conclusion**: Both trees have different TUI strengths. Not a clear advantage for either.

---

### `stats` - Usage Analytics

Both packages now have stats functionality.

#### `oh-my-pi` Features

- Session log parsing from `~/.omp/agent/sessions/`
- SQLite aggregation using `bun:sqlite`
- Web dashboard with Chart.js
- Incremental sync of session logs
- CLI stats entrypoint
- HTTP API endpoints

#### `pi-mono` Features

- Session log parsing
- SQLite aggregation
- Web dashboard
- Incremental sync
- HTTP server with API endpoints

**Conclusion**: Both have comparable stats packages now.

---

## Packages Missing in `pi-mono`

### `natives` - Native Rust Bindings

`pi-mono` has no equivalent package.

**Features**:
- **Grep**: Regex-based search powered by ripgrep's engine
- **Find**: Glob-based file/directory discovery with gitignore support
- **Image**: Image processing via photon-rs (resize, format conversion)
- **Clipboard**: Native clipboard helpers
- **PTY**: Native PTY helpers
- **Process**: Process tree and process helpers
- **Keyboard**: Native keyboard helpers
- **HTML/Text/Work**: Additional native utilities

**Source Structure**:
```
src/
├── appearance/    # Appearance helpers
├── ast/           # AST utilities
├── bindings.ts    # N-API bindings
├── clipboard/     # Clipboard operations
├── glob/          # Glob matching
├── grep/          # Ripgrep-based search
├── highlight/     # Syntax highlighting
├── html/          # HTML processing
├── image/         # Image processing
├── keys/          # Keyboard handling
├── native.ts      # Native addon
├── projfs/        # Project filesystem
├── ps/            # Process management
├── pty/           # PTY handling
├── shell/         # Shell integration
├── text/          # Text processing
└── work/          # Work utilities
```

**Impact**: This is a real systems-layer package gap. `pi-mono` relies on pure TypeScript implementations.

---

### `swarm-extension` - Multi-Agent Orchestration

`pi-mono` has no equivalent package.

**Features**:
- YAML-defined multi-agent workflows
- DAG execution
- Sequential / parallel / pipeline modes
- Persisted swarm state and logs under workspace
- Standalone `omp-swarm` runner
- TUI extension commands for swarm orchestration

**Source Structure**:
```
src/
├── cli.ts        # Standalone CLI runner
├── extension.ts  # TUI extension
└── swarm/        # Swarm orchestration logic
```

**Usage**:
```bash
# Standalone runner
omp-swarm path/to/swarm.yaml

# Inside TUI
/swarm run path/to/swarm.yaml
/swarm status <name>
```

**Impact**: This is a real unattended multi-agent orchestration gap.

---

### `react-edit-benchmark` - Edit Benchmarking

`pi-mono` has no equivalent package.

**Features**:
- Benchmark harness for code edits against React source mutations
- Task generation
- Mutation generation
- Verification and reporting
- Prompt-driven benchmark runner

**Impact**: This is a real evaluation/benchmarking package gap.

---

### `utils` - Shared Utilities

`pi-mono` has no standalone shared utilities package.

**Features**:
- CLI helpers (`cli.ts`)
- Logger subsystem (`logger.ts`)
- Process manager helpers (`procmgr.ts`, `ptree.ts`)
- Async and stream helpers (`async.ts`, `stream.ts`, `abortable.ts`)
- Temp/dir/env helpers (`temp.ts`, `dirs.ts`, `env.ts`)
- Mermaid-to-ASCII rendering (`mermaid-ascii.ts`)
- Ring buffer (`ring.ts`)
- Snowflake IDs (`snowflake.ts`)
- Formatting utilities (`format.ts`, `indent.ts`, `color.ts`)
- Filesystem utilities (`fs-error.ts`, `glob.ts`)

**Source Files**:
```
src/
├── abortable.ts    # Abortable operations
├── async.ts        # Async utilities
├── cli.ts          # CLI helpers
├── color.ts        # Color utilities
├── dirs.ts         # Directory helpers
├── env.ts          # Environment utilities
├── format.ts       # Formatting
├── fs-error.ts     # Filesystem errors
├── glob.ts         # Glob utilities
├── indent.ts       # Indentation helpers
├── index.ts        # Exports
├── json.ts         # JSON utilities
├── logger.ts       # Logging system
├── mermaid-ascii.ts # Mermaid to ASCII
├── postmortem.ts   # Postmortem debugging
├── procmgr.ts      # Process manager
├── ptree.ts        # Process tree
├── ring.ts         # Ring buffer
├── snowflake.ts    # Snowflake ID generator
├── stream.ts       # Stream utilities
├── temp.ts         # Temp file handling
└── type-guards.ts  # Type guard utilities
```

**Impact**: `pi-mono` has utilities spread inside individual packages, but not as a standalone shared package.

---

## Packages Missing in `oh-my-pi`

### `mom` - Slack Bot

`oh-my-pi` has no equivalent package.

**Features**:
- Slack bot integration via Socket Mode
- Self-managing environment (installs tools, configures credentials)
- Docker sandbox execution
- Persistent workspace with conversation history
- Working memory and custom tools (skills)
- Thread-based details
- Event system for scheduled wake-ups (immediate, one-shot, periodic)
- Channel-based isolation

**Source Structure**:
```
src/
├── main.ts      # Entry point, CLI, Slack setup
├── agent.ts     # Agent runner, event handling
├── slack.ts     # Slack integration
├── context.ts   # Session management
├── store.ts     # Data persistence
├── log.ts       # Logging
├── sandbox.ts   # Docker/host execution
├── download.ts  # File downloads
└── tools/       # Tool implementations
    ├── attach.ts
    ├── bash.ts
    ├── edit.ts
    ├── read.ts
    ├── truncate.ts
    └── write.ts
```

**Impact**: `oh-my-pi` has no Slack bot integration.

---

### `pods` - GPU Pod Management

`oh-my-pi` has no equivalent package.

**Features**:
- Deploy and manage LLMs on GPU pods
- Automatic vLLM configuration
- Support for DataCrunch, RunPod, Vast.ai, Prime Intellect, AWS EC2
- Predefined model configurations (Qwen, GPT-OSS, GLM)
- OpenAI-compatible API endpoints
- Interactive agent with file system tools
- Multi-GPU support with automatic assignment

**Source Structure**:
```
src/
├── cli.ts          # CLI entry point
├── index.ts        # Exports
├── config.ts       # Configuration
├── model-configs.ts # Model definitions
├── models.json     # Model data
├── ssh.ts          # SSH utilities
├── types.ts        # Type definitions
└── commands/
    ├── models.ts   # Model commands
    ├── pods.ts     # Pod management
    └── prompt.ts   # Prompt commands
```

**Impact**: `oh-my-pi` has no GPU pod management CLI.

---

### `web-ui` - Web Components

`oh-my-pi` has no equivalent package.

**Features**:
- Reusable web UI components for AI chat interfaces
- Built with mini-lit web components and Tailwind CSS v4
- Chat UI with message history, streaming, tool execution
- Tools: JavaScript REPL, document extraction, artifacts
- Attachments: PDF, DOCX, XLSX, PPTX, images with preview
- Artifacts: Interactive HTML, SVG, Markdown with sandboxed execution
- Storage: IndexedDB-backed storage for sessions, API keys, settings
- CORS proxy support for browser environments
- Custom provider support (Ollama, LM Studio, vLLM)

**Source Structure**:
```
src/
├── ChatPanel.ts           # Main chat interface
├── app.css                # Styles
├── index.ts               # Exports
├── components/            # UI components
│   ├── AgentInterface.ts
│   ├── AttachmentTile.ts
│   ├── ConsoleBlock.ts
│   ├── CustomProviderCard.ts
│   ├── ExpandableSection.ts
│   ├── Input.ts
│   ├── MessageEditor.ts
│   ├── MessageList.ts
│   ├── Messages.ts
│   ├── ProviderKeyInput.ts
│   ├── StreamingMessageContainer.ts
│   └── ThinkingBlock.ts
├── dialogs/               # Dialog components
│   ├── ApiKeyPromptDialog.ts
│   ├── AttachmentOverlay.ts
│   ├── CustomProviderDialog.ts
│   ├── ModelSelector.ts
│   ├── PersistentStorageDialog.ts
│   ├── ProvidersModelsTab.ts
│   ├── SessionListDialog.ts
│   └── SettingsDialog.ts
├── storage/               # Storage layer
│   ├── app-storage.ts
│   ├── store.ts
│   ├── types.ts
│   └── backends/
│       └── indexeddb-storage-backend.ts
├── tools/                 # Tool implementations
│   ├── index.ts
│   ├── extract-document.ts
│   ├── javascript-repl.ts
│   ├── renderer-registry.ts
│   ├── types.ts
│   ├── artifacts.ts
│   └── artifacts/
│       ├── ArtifactElement.ts
│       ├── ArtifactPill.ts
│       ├── Console.ts
│       ├── DocxArtifact.ts
│       ├── ExcelArtifact.ts
│       ├── GenericArtifact.ts
│       ├── HtmlArtifact.ts
│       ├── ImageArtifact.ts
│       ├── MarkdownArtifact.ts
│       ├── PdfArtifact.ts
│       ├── SvgArtifact.ts
│       └── TextArtifact.ts
├── utils/                 # Utilities
│   ├── attachment-utils.ts
│   ├── auth-token.ts
│   ├── format.ts
│   ├── i18n.ts
│   ├── model-discovery.ts
│   └── proxy-utils.ts
└── prompts/
    └── prompts.ts
```

**Impact**: `oh-my-pi` has no reusable web UI components package.

---

## Summary Matrix

| Feature Area | `pi-mono` | `oh-my-pi` | Winner |
|-------------|:---------:|:----------:|--------|
| **Core Agent Runtime** | ✅ | ✅ | Tie |
| **TUI Library** | ✅ | ✅ | Tie (different strengths) |
| **Stats/Analytics** | ✅ | ✅ | Tie |
| **LLM Providers** | 7 | 23+ | `oh-my-pi` |
| **Multi-command CLI** | ✅ (new) | ✅ | Tie |
| **SSH Integration** | ✅ (new) | ✅ | Tie |
| **Commit Automation** | ❌ | ✅ | `oh-my-pi` |
| **Plugin System** | ❌ | ✅ | `oh-my-pi` |
| **MCP Integration** | ❌ | ✅ | `oh-my-pi` |
| **LSP Integration** | ❌ | ✅ | `oh-my-pi` |
| **Jupyter Integration** | ❌ | ✅ | `oh-my-pi` |
| **Web Search** | ❌ | ✅ | `oh-my-pi` |
| **Memory System** | ❌ | ✅ | `oh-my-pi` |
| **Plan Mode** | ❌ | ✅ | `oh-my-pi` |
| **Native Bindings** | ❌ | ✅ | `oh-my-pi` |
| **Swarm Orchestration** | ❌ | ✅ | `oh-my-pi` |
| **Benchmark Tools** | ❌ | ✅ | `oh-my-pi` |
| **Shared Utils Package** | ❌ | ✅ | `oh-my-pi` |
| **Slack Bot** | ✅ | ❌ | `pi-mono` |
| **GPU Pod Management** | ✅ | ❌ | `pi-mono` |
| **Web UI Components** | ✅ | ❌ | `pi-mono` |
| **Tool Duration Tracking** | ✅ (new) | ❌ | `pi-mono` |
| **Streaming UI Buffering** | ✅ (new) | ❌ | `pi-mono` |
| **Status Line Tool Stats** | ✅ (new) | ❌ | `pi-mono` |

---

## Practical Recommendations

### For `pi-mono` Users

If you need features from `oh-my-pi`:
1. **More LLM providers**: Consider adding provider modules from `oh-my-pi`
2. **Multi-command CLI**: Would require significant restructuring
3. **Native bindings**: Could port `natives` package (requires Rust)
4. **Swarm orchestration**: Could port `swarm-extension` package
5. **Plugin system**: Would require new extensibility layer

### For `oh-my-pi` Users

If you need features from `pi-mono`:
1. **Slack bot**: Port `mom` package
2. **GPU pod management**: Port `pods` package
3. **Web UI**: Port `web-ui` package

---

## What I Deliberately Did Not Claim

To keep this accurate, I did not count these as advantages:

- `agent` package superiority: Not supported by package contents
- General TUI superiority: Both trees have different strengths
- Any feature that only exists outside the compared `packages` folders
- Any feature where `pi-mono` clearly has a different subsystem that already covers the same job

---

## Change Log

| Date | Changes |
|------|---------|
| 2026-03-06 | Initial comprehensive comparison |
| 2026-03-06 | Updated to reflect pi-mono CLI expansion: multi-command CLI, SSH integration, stats command, agents command. Added new pi-mono features: tool duration tracking, streaming UI buffering, status line tool stats |
