<p align="center">
  <a href="https://github.com/apholdings/jensen-code">
    <img src="https://raw.githubusercontent.com/apholdings/jensen-code/main/packages/coding-agent/docs/images/logo.svg" alt="Jensen Code logo" width="128">
  </a>
</p>
<p align="center">
  <a href="https://github.com/apholdings/jensen-code/actions/workflows/ci.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/apholdings/jensen-code/ci.yml?style=flat-square&branch=main" /></a>
</p>

# Jensen Code Monorepo

> **Looking for the Jensen Code coding agent?** See **[packages/coding-agent](packages/coding-agent)** for installation and usage.

Tools for building AI agents and managing LLM deployments.

## Packages

| Package | Description |
|---------|-------------|
| **[@apholdings/jensen-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@apholdings/jensen-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@apholdings/jensen-code](packages/coding-agent)** | Interactive coding agent CLI |
| **[@apholdings/jensen-mom](packages/mom)** | Slack bot that delegates messages to Jensen Code |
| **[@apholdings/jensen-tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@apholdings/jensen-web-ui](packages/web-ui)** | Web components for AI chat interfaces |
| **[@apholdings/jensen-pods](packages/pods)** | CLI for managing vLLM deployments on GPU pods |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./jensen-test.sh     # Run jensen from sources (must be run from repo root)
```

> **Note:** `npm run check` requires `npm run build` to be run first. The web-ui package uses `tsc` which needs compiled `.d.ts` files from dependencies.

## License

MIT
