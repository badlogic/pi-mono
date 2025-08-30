# Project: Pi Monorepo

A comprehensive toolkit for managing Large Language Model (LLM) deployments and building AI agents, specifically designed for deploying and managing LLMs on remote GPU pods with automatic vLLM configuration for agentic workloads.

## Features
- Unified LLM API with automatic model discovery and provider configuration
- Terminal UI framework with differential rendering and interactive components
- AI agent framework with tool calling, session persistence, and multiple renderers
- GPU pod management CLI for automated vLLM deployment on various providers
- Support for OpenAI, Anthropic, Google, Groq, Cerebras, xAI, OpenRouter, and compatible APIs
- Built-in file system tools for agentic AI capabilities
- Automatic cost tracking and token usage across all providers

## Tech Stack
- TypeScript/JavaScript with ES Modules
- Node.js ≥20.0.0
- OpenAI SDK, Anthropic SDK, Google Gemini SDK for LLM integration
- Custom TUI library with differential rendering
- Biome for linting and formatting
- npm workspaces for monorepo structure
- Automatic model discovery from OpenRouter and models.dev APIs

## Structure
- `packages/tui/` - Terminal UI library (@mariozechner/pi-tui)
- `packages/ai/` - Unified LLM API (@mariozechner/pi-ai)
- `packages/agent/` - AI agent with tool calling (@mariozechner/pi-agent)
- `packages/pods/` - CLI for GPU pod management (@mariozechner/pi)
- `scripts/` - Utility scripts for version sync
- `todos/` - Task tracking

## Architecture
- Unified LLM interface abstracting provider differences
- Event-driven agent system with publish-subscribe pattern
- Component-based TUI with differential rendering
- SSH-based remote pod management
- Tool calling system for file operations (read, bash, glob, ripgrep)
- Session persistence in JSONL format
- Multiple renderer strategies (Console, TUI, JSON)
- Automatic model capability detection (reasoning, vision, tool calling)

## Commands
- Build: `npm run build`
- Clean: `npm run clean`
- Lint/Check: `npm run check`
- Dev/Run: `npx tsx packages/agent/src/cli.ts` (pi-agent), `npx tsx packages/pods/src/cli.ts` (pi)
- Version: `npm run version:patch/minor/major`
- Publish: `npm run publish`
- Publish (dry run): `npm run publish:dry`

## Testing
The monorepo includes comprehensive tests using Node.js built-in test framework and Vitest:
- TUI package: Unit tests in `packages/tui/test/*.test.ts` (Node.js test framework)
- AI package: Provider tests in `packages/ai/test/*.test.ts` (Vitest)
- Test runner (TUI): `node --test --import tsx test/*.test.ts`
- Test runner (AI): `npm run test` (uses Vitest)
- Virtual terminal for TUI testing via `@xterm/headless`
- Example applications for manual testing

## How to Create a New Package

Follow these steps to add a new package to the monorepo:

1. **Create package directory structure:**
   ```bash
   mkdir -p packages/your-package/src
   ```

2. **Create package.json:**
   ```json
   {
     "name": "@mariozechner/your-package",
     "version": "0.5.12",
     "description": "Package description",
     "type": "module",
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "files": ["dist", "README.md"],
     "scripts": {
       "clean": "rm -rf dist",
       "build": "tsc -p tsconfig.build.json",
       "check": "biome check --write .",
       "prepublishOnly": "npm run clean && npm run build"
     },
     "dependencies": {},
     "devDependencies": {},
     "keywords": ["relevant", "keywords"],
     "author": "Mario Zechner",
     "license": "MIT",
     "repository": {
       "type": "git",
       "url": "git+https://github.com/badlogic/pi-mono.git",
       "directory": "packages/your-package"
     },
     "engines": {
       "node": ">=20.0.0"
     }
   }
   ```

3. **Create tsconfig.build.json:**
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src"
     },
     "include": ["src/**/*"],
     "exclude": ["node_modules", "dist"]
   }
   ```

4. **Create src/index.ts:**
   ```typescript
   // Main exports for your package
   export const version = "0.5.12";
   ```

5. **Update root tsconfig.json paths:**
   Add your package to the `paths` mapping in the correct dependency order:
   ```json
   "paths": {
     "@mariozechner/pi-tui": ["./packages/tui/src/index.ts"],
     "@mariozechner/pi-ai": ["./packages/ai/src/index.ts"],
     "@mariozechner/your-package": ["./packages/your-package/src/index.ts"],
     "@mariozechner/pi-agent": ["./packages/agent/src/index.ts"],
     "@mariozechner/pi": ["./packages/pods/src/index.ts"]
   }
   ```

6. **Update root package.json build script:**
   Insert your package in the correct dependency order:
   ```json
   "build": "npm run build -w @mariozechner/pi-tui && npm run build -w @mariozechner/pi-ai && npm run build -w @mariozechner/your-package && npm run build -w @mariozechner/pi-agent && npm run build -w @mariozechner/pi"
   ```

7. **Install and verify:**
   ```bash
   npm install
   npm run build
   npm run check
   ```

**Important Notes:**
- All packages use lockstep versioning (same version number)
- Follow dependency order: foundational packages build first
- Use ESM modules (`"type": "module"`)
- No `any` types unless absolutely necessary
- Include README.md with package documentation