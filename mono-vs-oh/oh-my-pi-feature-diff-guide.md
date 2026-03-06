# `oh-my-pi/packages` vs `pi-mono/packages`

This guide lists features that exist in `pi-guide/oh-my-pi/packages` and do not have a package-local equivalent in `packages`.

Scope rules used for this guide:

- Only compared files under `pi-guide/oh-my-pi/packages` and `packages`
- Used package READMEs, `package.json`, and source-tree contents
- Did not count root-level tooling, CI, or non-package folders
- Only called something a missing `pi-mono` feature when there was a concrete `oh-my-pi` subsystem and no equivalent subsystem under `packages/...`

## At a Glance

Shared package names:

- `agent`
- `ai`
- `coding-agent`
- `tui`

Packages that exist only in `oh-my-pi/packages`:

- `natives`
- `react-edit-benchmark`
- `stats`
- `swarm-extension`
- `utils`

Packages that exist only in `pi-mono/packages`:

- `mom`
- `pods`
- `web-ui`

Source LOC for shared packages:

| Package | `pi-mono` | `oh-my-pi` | Delta |
| --- | ---: | ---: | ---: |
| `coding-agent` | 212,577 | 179,131 | `pi-mono +33,446` |
| `ai` | 130,587 | 62,715 | `pi-mono +67,872` |
| `agent` | 65,125 | 3,443 | `pi-mono +61,682` |
| `tui` | 27,429 | 16,067 | `pi-mono +11,362` |

Important implication: `pi-mono` is larger, but `oh-my-pi` still has several package-level capabilities that `pi-mono` does not ship.

## Package-by-Package Differences

### `agent`

No clear `oh-my-pi`-only feature was confirmed from package contents.

- The relative `src` file set matches between the two trees.
- The `pi-mono` README surface is actually broader in some areas, such as separate `steeringMode`, `followUpMode`, `sessionId`, and `thinkingBudgets`.

Conclusion:

- Do not treat `agent` as an `oh-my-pi` advantage area based on package contents alone.

### `ai`

`oh-my-pi` has a broader provider/discovery/accounting surface.

Confirmed `oh-my-pi`-only provider entries from `README.md`:

- `Together`
- `Moonshot`
- `Qianfan`
- `NVIDIA`
- `NanoGPT`
- `Hugging Face Inference`
- `Venice`
- `Kilo Gateway`
- `LiteLLM`
- `zAI`
- `MiniMax Coding Plan`
- `Xiaomi MiMo`
- `Qwen Portal`
- `Cloudflare AI Gateway`
- `Ollama`
- `vLLM`

Confirmed `oh-my-pi`-only source subsystems:

- Dedicated provider modules not found in `pi-mono`:
  - `src/providers/cursor.ts`
  - `src/providers/gitlab-duo.ts`
  - `src/providers/kimi.ts`
  - `src/providers/synthetic.ts`
  - `src/providers/google-gemini-cli-usage.ts`
- Provider/model metadata system:
  - `src/model-cache.ts`
  - `src/model-manager.ts`
  - `src/provider-details.ts`
  - `src/provider-models/*`
  - published `src/models.json`
- Usage accounting modules:
  - `src/usage/*`
  - per-provider usage handlers for Claude, Copilot, Antigravity, Kimi, MiniMax Code, OpenAI Codex, zAI
- Broader OAuth and provider-discovery adapters:
  - `src/utils/discovery/*`
  - `src/utils/oauth/*`
  - includes provider-specific adapters for Cursor, GitLab Duo, Kilo, LiteLLM, LM Studio, Moonshot, NVIDIA, Ollama, Perplexity, Qianfan, Qwen Portal, Together, Venice, vLLM, Xiaomi, zAI
- Schema compatibility helpers:
  - `src/utils/schema/*`

What `pi-mono` does not have package-locally in `ai`:

- No equivalent `provider-models` subsystem
- No equivalent `usage/*` accounting tree
- No equivalent `utils/discovery/*` provider discovery tree
- No equivalent OAuth adapter spread for the providers above
- No dedicated provider files for Cursor, GitLab Duo, or Synthetic

### `coding-agent`

This is the largest `oh-my-pi`-only feature gap area.

Confirmed `oh-my-pi` CLI command surface not present as package-local subcommands in `pi-mono`:

- `agents`
- `commit`
- `config`
- `grep`
- `jupyter`
- `plugin`
- `setup`
- `shell`
- `ssh`
- `stats`
- `update`
- `search` / `q`

Evidence:

- `pi-guide/oh-my-pi/packages/coding-agent/src/cli.ts` explicitly registers these commands.
- `packages/coding-agent/src/cli.ts` is a single launcher into `main()`, not a multi-command CLI.

Confirmed `oh-my-pi`-only subsystems:

- Async job subsystem:
  - `src/async/*`
- Capability model:
  - `src/capability/*`
  - covers context files, extensions, hooks, MCP, prompts, rules, settings, skills, slash commands, SSH, system prompt, tools
- Commit automation stack:
  - `src/commit/*`
  - includes agentic commit generation, changelog helpers, git analysis, split-commit tooling
- Rich command implementations:
  - `src/commands/*`
- Config and discovery subsystems:
  - `src/config/*`
  - `src/discovery/*`
- Search / web / Exa subsystems:
  - `src/web/*`
  - `src/exa/*`
- External integration subsystems:
  - `src/mcp/*`
  - `src/lsp/*`
  - `src/ssh/*`
  - `src/ipy/*`
  - `src/stt/*`
- Memory and planning subsystems:
  - `src/memories/*`
  - `src/plan-mode/*`
- Patch and export subsystems:
  - `src/patch/*`
  - `src/export/*`
- Broader extensibility surface:
  - `src/extensibility/custom-commands/*`
  - `src/extensibility/custom-tools/*`
  - `src/extensibility/extensions/*`
  - `src/extensibility/hooks/*`
  - `src/extensibility/plugins/*`
- Separate slash-command subsystem:
  - `src/slash-commands/*`
- Dedicated task executor subsystem:
  - `src/task/*`

What `pi-mono` has instead:

- `core/*`, `modes/*`, and `addons-extensions/*`
- extension runtime, package manager, resource loader, subagent support, export HTML, settings, SDK

But those do not replace several `oh-my-pi`-specific surfaces above:

- multi-command CLI
- commit automation package surface
- plugin subsystem
- swarm/stats/native integration from inside coding-agent
- LSP / SSH / Jupyter / web-search command surfaces

### `tui`

`oh-my-pi` has a small set of TUI-specific modules that are not present in `pi-mono`.

Confirmed `oh-my-pi`-only modules:

- `src/bracketed-paste.ts`
- `src/components/tab-bar.ts`
- `src/symbols.ts`
- `src/terminal-capabilities.ts`
- `src/ttyid.ts`

These point to extra low-level terminal plumbing and a dedicated tab-bar component.

Important caveat:

- This is not a general TUI advantage verdict. `pi-mono` also has TUI capabilities that go the other direction, especially overlays and IME cursor support documented in `packages/tui/README.md`.

## Packages Missing Entirely in `pi-mono`

### `natives`

`pi-mono` has no equivalent package under `packages`.

Confirmed features from `README.md` and `src/`:

- Native grep bindings
- Native glob / find helpers
- Native image processing
- Native clipboard helpers
- Native PTY helpers
- Native process tree / process helpers
- Native keyboard helpers
- Native HTML / text / work helpers

This is a real systems-layer package gap.

### `stats`

`pi-mono` has no equivalent package under `packages`.

Confirmed features:

- Local observability dashboard for AI usage
- Session log parsing
- SQLite aggregation
- Web dashboard with Chart.js
- Incremental sync of session logs
- CLI stats entrypoint
- HTTP API endpoints for stats

This is a real analytics / observability package gap.

### `swarm-extension`

`pi-mono` has no equivalent package under `packages`.

Confirmed features:

- YAML-defined multi-agent workflows
- DAG execution
- sequential / parallel / pipeline modes
- persisted swarm state and logs under workspace
- standalone `omp-swarm` runner
- TUI extension commands for swarm orchestration

This is a real unattended multi-agent orchestration package gap.

### `react-edit-benchmark`

`pi-mono` has no equivalent package under `packages`.

Confirmed features:

- benchmark harness for code edits against React source mutations
- task generation
- mutation generation
- verification and reporting
- prompt-driven benchmark runner

This is a real evaluation / benchmarking package gap.

### `utils`

`pi-mono` has no equivalent shared utilities package under `packages`.

Confirmed features from `src/`:

- CLI helpers
- logger subsystem
- process manager helpers
- async and stream helpers
- temp/dir/env helpers
- Mermaid-to-ASCII rendering
- ring buffer, snowflake IDs, tree/process helpers

`pi-mono` has utilities spread inside individual packages, but not as a standalone shared package.

## Practical Summary

If you ask “what does `oh-my-pi/packages` have that `pi-mono/packages` does not?”, the main missing areas in `pi-mono` are:

1. A native systems package: `natives`
2. A built-in usage analytics dashboard package: `stats`
3. A YAML/DAG swarm orchestration package: `swarm-extension`
4. A benchmark/eval package for edit tasks: `react-edit-benchmark`
5. A standalone shared utilities package: `utils`
6. A wider `ai` provider/discovery/oauth/accounting surface
7. A much broader `coding-agent` command and subsystem surface, especially:
   - multi-command CLI
   - commit automation
   - plugin/hooks/capability framework
   - LSP / MCP / SSH / Jupyter / web-search subsystems

## What I Deliberately Did Not Claim

To keep this accurate, I did not count these as `oh-my-pi` wins:

- `agent` package superiority: not supported by package contents
- general TUI superiority: both trees have different strengths
- any feature that only exists outside the compared `packages` folders
- any feature where `pi-mono` clearly has a different subsystem that already covers the same job
