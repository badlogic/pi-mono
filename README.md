![Codi Header](wallhaven-jew6op.jpg)

# Codi Monorepo

> **Looking for the coding agent package?** See **[packages/coding-agent](packages/coding-agent)** for installation and usage.

Codi is a maintained fork of the Pi monorepo for custom local workflows while staying aligned with upstream Pi releases.

## CLI Split (Recommended)

This fork uses a split CLI setup:

- `codi`: runs this local fork from source (`/Users/ever/Documents/GitHub/Codi `)
- `pi`: runs upstream npm-installed Pi in an isolated config dir (`~/.pi-upstream/agent`)

This keeps custom Codi extensions/settings separate from upstream Pi.

## Current Package Scope

The custom package split in this fork is currently:

- User scope (`~/.pi/agent/settings.json`): general-purpose packages you may want from any directory
- Project scope ([`.pi/settings.json`](/Users/ever/Documents/GitHub/Codi%20/.pi/settings.json)): repo-local packages that should only load inside this checkout

Current status:

- `pokemon-tools` is intended for user scope so `/pokemon` and the `pokemon-player` skill are available across Codi sessions
- `evolution-tools` stays project-scoped because it writes outputs under `<cwd>/.pi/evolution/`
- `autoresearch-tools` remains project-scoped in this repo

## Packages

| Package | Description |
|---------|-------------|
| **[@mariozechner/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@mariozechner/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@mariozechner/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@mariozechner/pi-mom](packages/mom)** | Slack bot that delegates messages to the pi coding agent |
| **[@mariozechner/pi-tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@mariozechner/pi-web-ui](packages/web-ui)** | Web components for AI chat interfaces |
| **[@mariozechner/pi-pods](packages/pods)** | CLI for managing vLLM deployments on GPU pods |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pi-test.sh         # Run pi from sources (must be run from repo root)
```

> **Note:** `npm run check` requires `npm run build` to be run first. The web-ui package uses `tsc` which needs compiled `.d.ts` files from dependencies.

## License

MIT
