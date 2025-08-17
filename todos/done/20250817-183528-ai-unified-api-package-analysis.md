# Analysis: Creating Unified AI Package

## Package Structure Analysis for Pi Monorepo

Based on my examination of the existing packages (`tui`, `agent`, and `pods`), here are the comprehensive patterns and conventions used in this monorepo:

### 1. Package Naming Conventions

**Scoped NPM packages with consistent naming:**
- All packages use the `@mariozechner/` scope
- Package names follow the pattern: `@mariozechner/pi-<package-name>`
- Special case: the main CLI package is simply `@mariozechner/pi` (not `pi-pods`)

**Directory structure:**
- Packages are located in `/packages/<package-name>/`
- Directory names match the suffix of the npm package name (e.g., `tui`, `agent`, `pods`)

### 2. Package.json Structure Patterns

**Common fields across all packages:**
```json
{
  "name": "@mariozechner/pi-<name>",
  "version": "0.5.8",  // Lockstep versioning - all packages share same version
  "description": "...",
  "type": "module",    // All packages use ES modules
  "author": "Mario Zechner",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/badlogic/pi-mono.git",
    "directory": "packages/<name>"
  },
  "engines": {
    "node": ">=20.0.0"  // Consistent Node.js requirement
  }
}
```

**Binary packages (agent, pods):**
- Include `"bin"` field with CLI command mapping
- Examples: `"pi-agent": "dist/cli.js"` and `"pi": "dist/cli.js"`

**Library packages (tui):**
- Include `"main"` field pointing to built entry point
- Include `"types"` field for TypeScript definitions

### 3. Scripts Configuration

**Universal scripts across all packages:**
- `"clean": "rm -rf dist"` - Removes build artifacts
- `"build": "tsc -p tsconfig.build.json"` - Builds with dedicated build config
- `"check": "biome check --write ."` - Linting and formatting
- `"prepublishOnly": "npm run clean && npm run build"` - Pre-publish cleanup

**CLI-specific build scripts:**
- Add `&& chmod +x dist/cli.js` for executable permissions
- Copy additional assets (e.g., `&& cp src/models.json dist/` for pods package)

### 4. Dependencies Structure

**Dependency hierarchy follows a clear pattern:**
```
pi-tui (foundation) -> pi-agent (uses tui) -> pi (uses agent)
```

**Internal dependencies:**
- Use exact version matching for internal packages (e.g., `"^0.5.8"`)
- Agent depends on TUI: `"@mariozechner/pi-tui": "^0.5.8"`
- Pods depends on Agent: `"@mariozechner/pi-agent": "^0.5.8"`

**External dependencies:**
- Common dependencies like `chalk` are used across multiple packages
- Specialized dependencies are package-specific (e.g., `marked` for tui, `openai` for agent)

### 5. TypeScript Configuration

**Dual TypeScript configuration approach:**

**`tsconfig.build.json` (for production builds):**
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

**Root `tsconfig.json` (for development and type checking):**
- Contains path mappings for cross-package imports during development
- Includes all source and test files
- Uses `"noEmit": true` for type checking without building

### 6. Source Directory Structure

**Standard structure across all packages:**
```
src/
├── index.ts          # Main export file
├── cli.ts            # CLI entry point (if applicable)
├── <core-files>.ts   # Core functionality
├── components/       # Components (for tui)
├── tools/           # Tool implementations (for agent)
├── commands/        # Command implementations (for pods)
└── renderers/       # Output renderers (for agent)
```

### 7. Export Patterns (index.ts)

**Comprehensive type and function exports:**
- Export both types and implementation classes
- Use `export type` for type-only exports
- Group exports logically with comments
- Example from tui: exports components, interfaces, and utilities
- Example from agent: exports core classes, types, and utilities

### 8. Files Configuration

**Files included in NPM packages:**
- `"files": ["dist"]` or `"files": ["dist/**/*", "README.md"]`
- All packages include built `dist/` directory
- Some include additional files like README.md or scripts

### 9. README.md Structure

**Comprehensive documentation pattern:**
- Feature overview with key capabilities
- Quick start section with code examples
- Detailed API documentation
- Installation instructions
- Development setup
- Testing information (especially for tui)
- Examples and usage patterns

### 10. Testing Structure (TUI package)

**Dedicated test directory:**
- `test/` directory with `.test.ts` files for unit tests
- Example applications (e.g., `chat-app.ts`, `file-browser.ts`)
- Custom testing infrastructure (e.g., `virtual-terminal.ts`)
- Test script: `"test": "node --test --import tsx test/*.test.ts"`

### 11. Version Management

**Lockstep versioning:**
- All packages share the same version number
- Root package.json scripts handle version bumping across all packages
- Version sync script ensures internal dependency versions match

### 12. Build Order

**Dependency-aware build order:**
- Root build script builds packages in dependency order
- `"build": "npm run build -w @mariozechner/pi-tui && npm run build -w @mariozechner/pi-agent && npm run build -w @mariozechner/pi"`

### 13. Common Configuration Files

**Shared across monorepo:**
- `biome.json` - Unified linting and formatting configuration
- `tsconfig.base.json` - Base TypeScript configuration
- `.gitignore` - Ignores `dist/`, `node_modules/`, and other build artifacts
- Husky pre-commit hooks for formatting and type checking

### 14. Keywords and Metadata

**Descriptive keywords for NPM discovery:**
- Each package includes relevant keywords (e.g., "tui", "terminal", "agent", "ai", "llm")
- Keywords help with package discoverability

This analysis shows a well-structured monorepo with consistent patterns that would make adding new packages straightforward by following these established conventions.

## Monorepo Configuration Analysis

Based on my analysis of the pi-mono monorepo configuration, here's a comprehensive guide on how to properly integrate a new package:

### 1. Root Package.json Configuration

**Workspace Configuration:**
- Uses npm workspaces with `"workspaces": ["packages/*"]`
- All packages are located under `/packages/` directory
- Private monorepo (`"private": true`) with ESM modules (`"type": "module"`)

**Build System:**
- **Sequential Build Order**: The build script explicitly defines dependency order:
  ```json
  "build": "npm run build -w @mariozechner/pi-tui && npm run build -w @mariozechner/pi-agent && npm run build -w @mariozechner/pi"
  ```
- **Dependency Chain**: `pi-tui` → `pi-agent` → `pi` (pods)
- **Important**: New packages must be inserted in the correct dependency order in the build script

**Scripts Available:**
- `clean`: Cleans all package dist folders
- `build`: Sequential build respecting dependencies  
- `check`: Runs Biome formatting, package checks, and TypeScript checking
- `test`: Runs tests across all packages
- Version management scripts (lockstep versioning)
- Publishing scripts with dry-run capability

### 2. Root TypeScript Configuration

**Dual Configuration System:**
- **`tsconfig.base.json`**: Base TypeScript settings for all packages
- **`tsconfig.json`**: Development configuration with path mappings for cross-package imports
- **Package `tsconfig.build.json`**: Clean build configs per package

**Path Mappings** (in `/Users/badlogic/workspaces/pi-mono/tsconfig.json`):
```json
"paths": {
  "@mariozechner/pi-tui": ["./packages/tui/src/index.ts"],
  "@mariozechner/pi-agent": ["./packages/agent/src/index.ts"], 
  "@mariozechner/pi": ["./packages/pods/src/index.ts"]
}
```

### 3. Package Dependencies and Structure

**Dependency Structure:**
- `pi-tui` (base library) - no internal dependencies
- `pi-agent` depends on `pi-tui`
- `pi` (pods) depends on `pi-agent`

**Standard Package Structure:**
```
packages/new-package/
├── src/
│   ├── index.ts          # Main export file
│   └── ...               # Implementation files
├── package.json          # Package configuration
├── tsconfig.build.json   # Build-specific TypeScript config
├── README.md            # Package documentation
└── dist/                # Build output (gitignored)
```

### 4. Version Management

**Lockstep Versioning:**
- All packages share the same version number (currently 0.5.8)
- Automated version sync script: `/Users/badlogic/workspaces/pi-mono/scripts/sync-versions.js`
- Inter-package dependencies are automatically updated to match current versions

**Version Scripts:**
- `npm run version:patch/minor/major` - Updates all package versions and syncs dependencies
- Automatic dependency version synchronization

### 5. GitIgnore Patterns

**Package-Level Ignores:**
```
packages/*/node_modules/
packages/*/dist/
```
Plus standard ignores for logs, IDE files, environment files, etc.

## How to Integrate a New Package

### Step 1: Create Package Structure
```bash
mkdir packages/your-new-package
cd packages/your-new-package
```

### Step 2: Create package.json
```json
{
  "name": "@mariozechner/your-new-package",
  "version": "0.5.8",
  "description": "Your package description",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "clean": "rm -rf dist",
    "build": "tsc -p tsconfig.build.json",
    "check": "biome check --write .",
    "prepublishOnly": "npm run clean && npm run build"
  },
  "dependencies": {
    // Add dependencies on other packages in the monorepo if needed
    // "@mariozechner/pi-tui": "^0.5.8"
  },
  "devDependencies": {},
  "keywords": ["relevant", "keywords"],
  "author": "Mario Zechner",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/badlogic/pi-mono.git",
    "directory": "packages/your-new-package"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### Step 3: Create tsconfig.build.json
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

### Step 4: Create src/index.ts
```typescript
// Main exports for your package
export * from './your-main-module.js';
```

### Step 5: Update Root Configuration

**Add to `/Users/badlogic/workspaces/pi-mono/tsconfig.json` paths:**
```json
"paths": {
  "@mariozechner/pi-tui": ["./packages/tui/src/index.ts"],
  "@mariozechner/pi-agent": ["./packages/agent/src/index.ts"],
  "@mariozechner/pi": ["./packages/pods/src/index.ts"],
  "@mariozechner/your-new-package": ["./packages/your-new-package/src/index.ts"]
}
```

**Update build script in root `/Users/badlogic/workspaces/pi-mono/package.json`:**
```json
"build": "npm run build -w @mariozechner/pi-tui && npm run build -w @mariozechner/pi-agent && npm run build -w @mariozechner/your-new-package && npm run build -w @mariozechner/pi"
```
(Insert in correct dependency order)

### Step 6: Update sync-versions.js
If your package depends on other monorepo packages, add synchronization logic to `/Users/badlogic/workspaces/pi-mono/scripts/sync-versions.js`.

### Step 7: Install and Test
```bash
# From monorepo root
npm install
npm run build
npm run check
```

## Key Requirements for New Packages

1. **Must use ESM modules** (`"type": "module"`)
2. **Must follow lockstep versioning** (same version as other packages)
3. **Must be placed in correct build order** based on dependencies
4. **Must use tab indentation** (Biome config: `"indentStyle": "tab"`)
5. **Must avoid `any` types** unless absolutely necessary (project instruction)
6. **Must include proper TypeScript declarations** (`"declaration": true`)
7. **Must use Node.js >= 20.0.0** (engine requirement)
8. **Must follow the standard package structure** with src/, dist/, proper exports

## Development Workflow

1. **Development**: Use `tsx` to run source files directly (no build needed)
2. **Type Checking**: `npm run check` works across all packages
3. **Building**: Sequential builds respect dependency order
4. **Publishing**: Automatic version sync and cross-package dependency updates
5. **Testing**: Each package can have its own test suite

This monorepo is well-structured for maintaining multiple related packages with clean dependency management and automated version synchronization.

## Detailed Findings: Unified AI API Requirements Based on Current pi-agent Usage

After thoroughly analyzing the existing agent package (`/Users/badlogic/workspaces/pi-mono/packages/agent`), here are the comprehensive requirements for a unified AI API based on current usage patterns:

### **1. Core API Structure & Event System**

**Current Pattern:**
- Event-driven architecture using `AgentEvent` types
- Single `AgentEventReceiver` interface for all output handling
- Support for both single-shot and interactive modes

**Required API Features:**
```typescript
type AgentEvent = 
  | { type: "session_start"; sessionId: string; model: string; api: string; baseURL: string; systemPrompt: string }
  | { type: "assistant_start" }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: string }
  | { type: "tool_result"; toolCallId: string; result: string; isError: boolean }
  | { type: "assistant_message"; text: string }
  | { type: "error"; message: string }
  | { type: "user_message"; text: string }
  | { type: "interrupted" }
  | { type: "token_usage"; inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens: number }
```

### **2. OpenAI API Integration Patterns**

**Current Implementation:**
- Uses OpenAI SDK v5.12.2 (`import OpenAI from "openai"`)
- Supports both Chat Completions (`/v1/chat/completions`) and Responses API (`/v1/responses`)
- Provider detection based on base URL patterns

**Provider Support Required:**
```typescript
// Detected providers based on baseURL patterns
type Provider = "openai" | "gemini" | "groq" | "anthropic" | "openrouter" | "other"

// Provider-specific configurations
interface ProviderConfig {
  openai: { reasoning_effort: "minimal" | "low" | "medium" | "high" }
  gemini: { extra_body: { google: { thinking_config: { thinking_budget: number, include_thoughts: boolean } } } }
  groq: { reasoning_format: "parsed", reasoning_effort: string }
  openrouter: { reasoning: { effort: "low" | "medium" | "high" } }
}
```

### **3. Streaming vs Non-Streaming**

**Current Status:**
- **No streaming currently implemented** - uses standard request/response
- All API calls are non-streaming: `await client.chat.completions.create()` and `await client.responses.create()`
- Events are emitted synchronously after full response

**Streaming Requirements for Unified API:**
- Support for streaming responses with partial content updates
- Event-driven streaming with `assistant_message_delta` events
- Proper handling of tool call streaming
- Reasoning token streaming for supported models

### **4. Tool Calling Architecture**

**Current Implementation:**
```typescript
// Tool definitions for both APIs
toolsForResponses: Array<{type: "function", name: string, description: string, parameters: object}>
toolsForChat: ChatCompletionTool[]

// Tool execution with abort support
async function executeTool(name: string, args: string, signal?: AbortSignal): Promise<string>

// Built-in tools: read, list, bash, glob, rg (ripgrep)
```

**Unified API Requirements:**
- Automatic tool format conversion between Chat Completions and Responses API
- Built-in tools with filesystem and shell access
- Custom tool registration capability
- Tool execution with proper abort/interrupt handling
- Tool result streaming for long-running operations

### **5. Message Structure Handling**

**Current Pattern:**
- Dual message format support based on API type
- Automatic conversion between formats in `setEvents()` method

**Chat Completions Format:**
```typescript
{ role: "system" | "user" | "assistant" | "tool", content: string, tool_calls?: any[] }
```

**Responses API Format:**
```typescript
{ type: "message" | "function_call" | "function_call_output", content: any[] }
```

### **6. Session Persistence System**

**Current Implementation:**
```typescript
interface SessionData {
  config: AgentConfig
  events: SessionEvent[]
  totalUsage: TokenUsage
}

// File-based persistence in ~/.pi/sessions/
// JSONL format with session headers and event entries
// Automatic session continuation support
```

**Requirements:**
- Directory-based session organization
- Event replay capability for session restoration
- Cumulative token usage tracking
- Session metadata (config, timestamps, working directory)

### **7. Token Counting & Usage Tracking**

**Current Implementation:**
```typescript
interface TokenUsage {
  inputTokens: number
  outputTokens: number  
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number  // For o1/o3 and reasoning models
}
```

**Provider-Specific Token Mapping:**
- OpenAI: `prompt_tokens`, `completion_tokens`, `cached_tokens`, `reasoning_tokens`
- Responses API: `input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens`
- Cumulative tracking across conversations

### **8. Abort/Interrupt Handling**

**Current Pattern:**
```typescript
class Agent {
  private abortController: AbortController | null = null
  
  async ask(message: string) {
    this.abortController = new AbortController()
    // Pass signal to all API calls and tool executions
  }
  
  interrupt(): void {
    this.abortController?.abort()
  }
}
```

**Requirements:**
- AbortController integration for all async operations
- Graceful interruption of API calls, tool execution, and streaming
- Proper cleanup and "interrupted" event emission
- Signal propagation to nested operations

### **9. Reasoning/Thinking Support**

**Current Implementation:**
```typescript
// Provider-specific reasoning extraction
function parseReasoningFromMessage(message: any, baseURL?: string): {
  cleanContent: string
  reasoningTexts: string[]
}

// Automatic reasoning support detection
async function checkReasoningSupport(client, model, api, baseURL, signal): Promise<boolean>
```

**Provider Support:**
- **OpenAI o1/o3**: Full thinking content via Responses API
- **Groq GPT-OSS**: Reasoning via `reasoning_format: "parsed"`  
- **Gemini 2.5**: Thinking content via `<thought>` tags
- **OpenRouter**: Model-dependent reasoning support

### **10. Error Handling Patterns**

**Current Approach:**
- Try/catch blocks around all API calls
- Error events emitted through event system
- Specific error handling for reasoning model failures
- Provider-specific error interpretation

### **11. Configuration Management**

**Current Structure:**
```typescript
interface AgentConfig {
  apiKey: string
  baseURL: string
  model: string
  api: "completions" | "responses"
  systemPrompt: string
}
```

**Provider Detection:**
```typescript
function detectProvider(baseURL?: string): Provider {
  // URL pattern matching for automatic provider configuration
}
```

### **12. Output Rendering System**

**Current Renderers:**
- **ConsoleRenderer**: Terminal output with animations, token display
- **TuiRenderer**: Full interactive TUI with pi-tui integration
- **JsonRenderer**: JSONL event stream output

**Requirements:**
- Event-based rendering architecture
- Real-time token usage display
- Loading animations for async operations
- Markdown rendering support
- Tool execution progress indication

### **Summary: Key Unified API Requirements**

1. **Event-driven architecture** with standardized event types
2. **Dual API support** (Chat Completions + Responses API) with automatic format conversion
3. **Provider abstraction** with automatic detection and configuration
4. **Comprehensive tool system** with abort support and built-in tools
5. **Session persistence** with event replay and token tracking
6. **Reasoning/thinking support** across multiple providers
7. **Interrupt handling** with AbortController integration
8. **Token usage tracking** with provider-specific mapping
9. **Flexible rendering** through event receiver pattern
10. **Configuration management** with provider-specific settings

The unified API should maintain this event-driven, provider-agnostic approach while adding streaming capabilities and enhanced tool execution features that the current implementation lacks.