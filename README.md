# Pi Monorepo

A collection of tools for managing LLM deployments and building AI agents.

## Packages

- **[@mariozechner/pi-ai](packages/ai)** - Unified multi-provider LLM API
- **[@mariozechner/pi-tui](packages/tui)** - Terminal UI library with differential rendering
- **[@mariozechner/pi-agent](packages/agent)** - General-purpose agent with tool calling and session persistence
- **[@mariozechner/pi](packages/pods)** - CLI for managing vLLM deployments on GPU pods

## Development

This is a monorepo using npm workspaces for package management and a dual TypeScript configuration for development and building.

### Common Commands

```bash
# Install all dependencies
npm install

# Build all packages (required for publishing to NPM)
npm run build

# Clean out dist/ folders in all packages
npm run clean

# Run linting, formatting, and tsc typechecking (no build needed)
npm run check

# Run directly with tsx during development (no build needed)
cd packages/pods && npx tsx src/cli.ts
cd packages/agent && npx tsx src/cli.ts
```

### Package Dependencies

The packages have the following dependency structure:

`pi-tui` -> `pi-agent` -> `pi`

When new packages are added, the must be inserted in the correct order in the `build` script in `package.json`.

### TypeScript Configuration

The monorepo uses a dual TypeScript configuration approach:
- **Root `tsconfig.json`**: Contains path mappings for all packages, used for type checking and development with `tsx`
- **Package `tsconfig.build.json`**: Clean build configuration with `rootDir` and `outDir`, used for production builds

This setup allows:
- Type checking without building (`npm run check` works immediately)
- Running source files directly with `tsx` during development
- Clean, organized build outputs for publishing

### Versioning

All packages use **lockstep versioning** - they share the same version number:

```bash
# Bump patch version (0.5.0 -> 0.5.1)
npm run version:patch

# Bump minor version (0.5.0 -> 0.6.0)
npm run version:minor

# Bump major version (0.5.0 -> 1.0.0)
npm run version:major
```

These commands automatically:
1. Update all package versions
2. Sync inter-package dependency versions
3. Update package-lock.json

### Publishing

```bash
# Dry run to see what would be published
npm run publish:dry

# Publish all packages to npm
npm run publish
```

## License

MIT