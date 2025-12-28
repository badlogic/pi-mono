# Pi Monorepo

Tools for building AI agents and managing LLM deployments.

## Packages

| Package | Description |
|---------|-------------|
| **[@mariozechner/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@mariozechner/pi-agent](packages/agent)** | Agent runtime with tool calling and state management |
| **[@mariozechner/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@mariozechner/pi-mom](packages/mom)** | Slack bot that delegates messages to the pi coding agent |
| **[@mariozechner/pi-tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@mariozechner/pi-web-ui](packages/web-ui)** | Web components for AI chat interfaces |
| **[@mariozechner/pi-pods](packages/pods)** | CLI for managing vLLM deployments on GPU pods |

## Development

### Setup

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint, format, and type check
```

> **Note:** `npm run check` requires `npm run build` to be run first. The web-ui package uses `tsc` which needs compiled `.d.ts` files from dependencies.

### CI

GitHub Actions runs on push to `main` and on pull requests. The workflow runs `npm run check` and `npm run test` for each package in parallel.

**Do not add LLM API keys as secrets to this repository.** Tests that require LLM access use `describe.skipIf()` to skip when API keys are missing. This is intentional:

- PRs from external contributors would have access to secrets in the CI environment
- Malicious PR code could exfiltrate API keys
- Tests that need LLM calls are skipped on CI and run locally by developers who have keys configured

If you need to run LLM-dependent tests, run them locally with your own API keys.

### Development

Start watch builds for all packages:
```bash
npm run dev
```

Then run with tsx:
```bash
cd packages/coding-agent && npx tsx src/cli.ts
cd packages/pods && npx tsx src/cli.ts
```

### Versioning (Lockstep)

**All packages MUST always have the same version number.** Use these commands to bump versions:

```bash
npm run version:patch    # 0.7.5 -> 0.7.6
npm run version:minor    # 0.7.5 -> 0.8.0
npm run version:major    # 0.7.5 -> 1.0.0
```

These commands:
1. Update all package versions to the same number
2. Update inter-package dependency versions (e.g., `pi-agent` depends on `pi-ai@^0.7.7`)
3. Update `package-lock.json`

**Never manually edit version numbers.** The lockstep system ensures consistency across the monorepo.

### Publishing

```bash
npm run release:patch    # Bug fixes
npm run release:minor    # New features
npm run release:major    # Breaking changes
```

This handles version bump, CHANGELOG updates, commit, tag, publish, and push.

**NPM Token Setup**: Requires a granular access token with "Bypass 2FA on publish" enabled.
- Go to https://www.npmjs.com/settings/badlogic/tokens/
- Create a new "Granular Access Token" with "Bypass 2FA on publish"
- Set the token: `npm config set //registry.npmjs.org/:_authToken=YOUR_TOKEN`

## License

MIT