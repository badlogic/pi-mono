# Project: Pi Monorepo

A comprehensive toolkit for managing Large Language Model (LLM) deployments and building AI agents, specifically designed for deploying and managing LLMs on remote GPU pods with automatic vLLM configuration for agentic workloads.

## Features
- Terminal UI framework with differential rendering and interactive components
- AI agent framework with tool calling, session persistence, and multiple renderers
- GPU pod management CLI for automated vLLM deployment on various providers
- Support for OpenAI, Anthropic, Groq, OpenRouter, and compatible APIs
- Built-in file system tools for agentic AI capabilities

## Tech Stack
- TypeScript/JavaScript with ES Modules
- Node.js ≥20.0.0
- OpenAI SDK for LLM integration
- Custom TUI library with differential rendering
- Biome for linting and formatting
- npm workspaces for monorepo structure

## Structure
- `packages/tui/` - Terminal UI library
- `packages/agent/` - AI agent with tool calling
- `packages/pods/` - CLI for GPU pod management
- `scripts/` - Utility scripts for version sync
- `todos/` - Task tracking

## Architecture
- Event-driven agent system with publish-subscribe pattern
- Component-based TUI with differential rendering
- SSH-based remote pod management
- Tool calling system for file operations (read, bash, glob, ripgrep)
- Session persistence in JSONL format
- Multiple renderer strategies (Console, TUI, JSON)

## Commands
- Lint: `npm run check`
- Dev/Run: `npx tsx packages/agent/src/cli.ts` (pi-agent), `npx tsx packages/pods/src/cli.ts` (pi)
- Version: `npm run version:patch/minor/major`
- Publish: `npm run publish`

## Testing
Currently no formal testing framework is configured. Test infrastructure exists but no actual test files or framework dependencies are present.