# Extension Loading

Unified system for loading hooks, tools, skills, and themes from local files, directories, npm packages, and git repositories.

## Extension Types

| Type | Root Entry | Subdir Entry | Purpose |
|------|------------|--------------|---------|
| Hooks | `*.ts` / `*.js` | `index.ts` / `index.js` / package.json `main` | Event handlers for agent lifecycle |
| Tools | `*.ts` / `*.js` | `index.ts` / `index.js` / package.json `main` | Custom tools for the agent |
| Skills | `*.md` | `SKILL.md` | Context/instructions loaded into agent |
| Themes | `*.theme.json` | `*.theme.json` (recursive) | Color schemes for TUI |

**Note:** Themes use `*.theme.json` pattern scanned recursively at all levels, allowing flat theme packs without requiring subdirectories.

## Sources

Extensions can be loaded from:

### File Paths
```
./my-hook.ts
~/global-hook.ts
/absolute/path/hook.ts
```

### Directories
```
./my-hooks/
~/.pi/agent/hooks/
```

### npm Packages
```
npm:package-name
npm:package-name@1.2.3
npm:package-name@latest
npm:@scope/package-name
npm:@scope/package-name@1.2.3
```

### Git Repositories
```
git:https://github.com/user/repo
git:https://github.com/user/repo@v1.0.0      # tag
git:https://github.com/user/repo@abc123f     # commit
git:https://github.com/user/repo#branch      # branch
```

## Storage Layout

### Permanent (settings.json)
```
~/.pi/agent/
  hooks/
    my-local-hook.ts                    # root-level file
    complex-hook/                       # directory with entry point
      index.ts
      utils.ts
    npm/
      my-hook@1.2.3/                    # npm package
        package.json
        node_modules/
        index.js
      @scope/
        scoped-hook@2.0.0/
          ...
    git/
      github.com/user/repo@v1.0.0/      # git repo
        ...
  tools/
    ... (same structure)
  skills/
    ... (same structure, but SKILL.md instead of index.ts)
  themes/
    dark.theme.json                     # root-level theme
    light.theme.json
    community-pack/                     # theme pack (no entry point needed)
      nord.theme.json
      dracula.theme.json
    npm/
      cool-themes@1.0.0/
        monokai.theme.json
        solarized.theme.json
```

### Ephemeral (CLI flags)
```
/tmp/pi-extensions/
  hooks/
    npm/
      my-hook@1.0.0/
    git/
      github.com/user/repo@v1.0.0/
  tools/
    ...
  skills/
    ...
  themes/
    ...
```

Temp directory persists until OS clears `/tmp/`. No re-download needed across sessions (usually).

## Entry Point Resolution

For each discovered directory, resolve entry point in order:

### Hooks & Tools
1. `index.ts` (if exists)
2. `index.js` (if exists)
3. `main` field in `package.json` (if exists)

### Skills
1. `SKILL.md` (required)

### Themes
Themes use recursive pattern matching instead of fixed entry points:
- Scan recursively for `*.theme.json` files at all levels
- Each matching file is a separate theme
- Path derived from filename (e.g., `dark.theme.json` → `dark`, `pack/nord.theme.json` → `pack/nord`)

## Scanning Algorithm

```
scan(baseDir, config):
  results = []
  
  for entry in baseDir:
    skip if entry.name starts with "."
    skip if entry.name == "node_modules"
    skip if entry.name ends with ".installing"
    
    if entry is file:
      if matches rootPattern (e.g., *.ts, *.js, *.md, *.theme.json):
        results.add(entry)
    
    if entry is directory:
      if config.recursivePattern:
        # For themes: scan recursively for *.theme.json everywhere
        results.addAll(scan(directory, config))
      else if has entryPoint (index.ts, index.js, SKILL.md):
        results.add(directory)  # load as single extension
      else:
        results.addAll(scan(directory, config))  # recurse to find extensions
  
  return results
```

**Default directories scanned (always, regardless of settings.json):**
- `~/.pi/agent/<type>/`
- `<cwd>/.pi/<type>/`

## Extension Packs

A key use case is pulling in a **pack** (collection) of extensions via a directory, npm package, or git repo, then filtering to a subset.

**Example: Skill pack**
```
npm:pi-skills@1.0.0 contains:
  skills/
    brave-search/SKILL.md
    browser-tools/SKILL.md
    transcribe/SKILL.md
    youtube-transcript/SKILL.md
    ... (10+ skills)
```

You want only 2 of them:
```json
{
  "skills": {
    "paths": ["npm:pi-skills@1.0.0"],
    "filter": ["brave-search", "youtube-transcript"]
  }
}
```

**Example: Theme pack**
```
npm:community-themes@1.0.0 contains:
  themes/
    nord.theme.json
    dracula.theme.json
    solarized-dark.theme.json
    solarized-light.theme.json
    monokai.theme.json
```

Exclude solarized variants:
```json
{
  "themes": {
    "paths": ["npm:community-themes@1.0.0"],
    "filter": ["!solarized-*"]
  }
}
```

**Example: Hook pack**
```
npm:audit-hooks@1.0.0 contains:
  hooks/
    file-audit/index.ts
    command-audit/index.ts
    network-audit/index.ts
    debug-logger/index.ts
```

All except debug:
```json
{
  "hooks": {
    "paths": ["npm:audit-hooks@1.0.0"],
    "filter": ["!debug-*"]
  }
}
```

## Filtering

Single filter array with `!` prefix for exclusion. Patterns are matched against extension paths (directory or filename without extension).

```json
{
  "filter": ["pattern1", "pattern2", "!excluded-pattern"]
}
```

**Logic:**
1. Collect all patterns without `!` prefix → include patterns
2. Collect all patterns with `!` prefix → exclude patterns
3. If include patterns exist: start with extensions matching any include pattern
4. If no include patterns: start with all extensions
5. Remove extensions matching any exclude pattern

**Examples:**
```json
["brave-search"]                    // only brave-search
["brave-*", "docker"]               // brave-search, brave-api, docker
["!transcribe"]                     // all except transcribe
["audit-*", "!audit-debug"]         // audit-* except audit-debug
```

Patterns are glob patterns matched against extension paths.

## CLI Arguments

### Adding Sources
```bash
pi --hook <path|npm:|git:>      # add hook source (repeatable)
pi --tool <path|npm:|git:>      # add custom tool source (repeatable)
pi --skill <path|npm:|git:>     # add skill source (repeatable)
pi --theme <path|npm:|git:>     # add theme source (repeatable)
```

**Installation locations for npm/git sources:**

| Source | Install location |
|--------|------------------|
| CLI flags | `/tmp/pi-extensions/<type>/npm/` or `git/` |
| Global settings (`~/.pi/agent/settings.json`) | `~/.pi/agent/<type>/npm/` or `git/` |
| Project settings (`<cwd>/.pi/settings.json`) | `<cwd>/.pi/<type>/npm/` or `git/` |

File/directory paths are used directly (no installation).

- **CLI = ephemeral**: cached in temp until OS clears `/tmp/`
- **Global settings = permanent**: installed to user's agent directory
- **Project settings = project-local**: installed to project's `.pi/` directory

Examples:
- `--hook npm:my-hook@1.0.0` → `/tmp/pi-extensions/hooks/npm/my-hook@1.0.0/`
- Global settings.json `npm:my-hook@1.0.0` → `~/.pi/agent/hooks/npm/my-hook@1.0.0/`
- Project settings.json `npm:my-hook@1.0.0` → `<cwd>/.pi/hooks/npm/my-hook@1.0.0/`

This encourages: try via CLI, if you like it, add to settings.json for permanent install.

### Filtering
```bash
pi --hooks "pattern1,pattern2,!excluded"       # filter hooks
pi --custom-tools "pattern1,!excluded"         # filter custom tools
pi --skills "pattern1,pattern2"                # filter skills
pi --themes "pattern1"                         # filter themes
```

### Disabling
```bash
pi --no-hooks                   # disable all hooks
pi --no-custom-tools            # disable all custom tools
pi --no-skills                  # disable all skills (already exists)
```

### Built-in Tools
```bash
pi --tools read,bash,edit,write    # select which built-in tools to enable (unchanged)
```

## Settings Hierarchy

Extensions are configured in settings.json at two levels:
- **Global**: `~/.pi/agent/settings.json`
- **Project**: `<cwd>/.pi/settings.json`

**Merge behavior:**
- `paths`: **additive** - project paths are added to global paths
- `filter`: **override** - project filter replaces global filter if specified

**Example:**
```json
// Global: ~/.pi/agent/settings.json
{
  "hooks": {
    "paths": ["npm:audit-hooks@1.0.0"],
    "filter": ["!debug-*"]
  }
}

// Project: .pi/settings.json
{
  "hooks": {
    "paths": ["./project-hooks/"],
    "filter": ["audit-*"]           // overrides global filter
  }
}

// Effective:
{
  "hooks": {
    "paths": ["npm:audit-hooks@1.0.0", "./project-hooks/"],
    "filter": ["audit-*"]
  }
}
```

## settings.json Structure

```json
{
  "hooks": {
    "paths": [
      "./my-hooks/",
      "npm:@scope/hook@1.0.0",
      "git:https://github.com/user/hooks@v1.0.0"
    ],
    "filter": ["audit-*", "!audit-debug"]
  },
  "tools": {
    "paths": ["npm:cool-tools@2.0.0"],
    "filter": ["!dangerous-tool"]
  },
  "skills": {
    "paths": ["npm:pi-skills@1.0.0", "~/my-skills/"],
    "filter": ["brave-search", "git-*", "!git-legacy"]
  },
  "themes": {
    "paths": ["npm:community-themes@1.0.0"]
  }
}
```

**Migration from current format:**
- `hooks: string[]` → `hooks.paths: string[]`
- `customTools: string[]` → `tools.paths: string[]`
- `skills.customDirectories` → `skills.paths`
- `skills.includeSkills` → `skills.filter` (patterns without `!`)
- `skills.ignoredSkills` → `skills.filter` (patterns with `!` prefix)

## Installation Flow

Target directory depends on source:
- **CLI flags**: `/tmp/pi-extensions/<type>/npm/` or `git/`
- **Global settings.json**: `~/.pi/agent/<type>/npm/` or `git/`
- **Project settings.json**: `<cwd>/.pi/<type>/npm/` or `git/`

### Atomic Installation

To prevent corrupted state from interrupted installs (Ctrl+C):
1. Install to `<target>.installing/` (temporary)
2. On success, atomically rename to `<target>/`
3. If interrupted, `<target>/` doesn't exist → next run retries cleanly
4. Scanner filters out `*.installing` directories (see Scanning Algorithm)

### npm Packages
1. Parse specifier: `npm:@scope/pkg@1.2.3` → name: `@scope/pkg`, version: `1.2.3`
2. Determine target dir based on source (CLI → temp, global → agent dir, project → cwd/.pi/)
3. If `<target>/` exists and has matching version in package.json → skip install
4. Otherwise:
   - Remove stale `<target>.installing/` if exists
   - `npm pack @scope/pkg@1.2.3` → download tarball
   - Extract to `<target>.installing/`
   - If `package.json` has `dependencies` → run `npm install`
   - Rename `<target>.installing/` → `<target>/`

### Git Repositories
1. Parse specifier: `git:https://github.com/user/repo@v1.0.0`
2. Determine target dir based on source (CLI → temp, global → agent dir, project → cwd/.pi/)
3. If `<target>/` exists → skip clone
4. Otherwise:
   - Remove stale `<target>.installing/` if exists
   - `git clone <url>` to `<target>.installing/`
   - `git checkout <tag|commit|branch>`
   - If `package.json` has `dependencies` → run `npm install`
   - Rename `<target>.installing/` → `<target>/`

## Extension Management Commands

### Install

Adds extension to settings.json and installs to disk.

```bash
pi install <type> <source>              # global (default)
pi install <type> -p <source>           # project-local
pi install <type> --project <source>    # project-local

# Examples:
pi install hook npm:@scope/my-hook@1.0.0
  # → adds to ~/.pi/agent/settings.json
  # → installs to ~/.pi/agent/hooks/npm/@scope/my-hook@1.0.0/

pi install tool -p git:https://github.com/user/tool@v1.0.0
  # → adds to <cwd>/.pi/settings.json
  # → installs to <cwd>/.pi/tools/git/github.com/user/tool@v1.0.0/
```

### Remove

Removes extension from settings.json and deletes from disk.

```bash
pi remove <type> <name>                 # from global
pi remove <type> -p <name>              # from project

# Examples:
pi remove hook my-hook                  # from ~/.pi/agent/settings.json + delete
pi remove skill -p brave-search         # from <cwd>/.pi/settings.json + delete
```

### Update

Updates npm/git extensions to latest versions.

```bash
pi update                               # all (project + global)
pi update -p                            # project only
pi update <type>...                     # specific types
pi update -p <type>...                  # project, specific types

# Examples:
pi update                               # update everything
pi update hook tool                     # update hooks and tools
pi update -p skill                      # update project skills only
```

**Update behavior:**
- `npm:pkg@<version>`: check if newer version exists (e.g., `@latest` resolves to newer)
- `git:repo#branch`: `git pull`
- `git:repo@tag` or `git:repo@commit`: no-op (pinned)
- Local files/directories: no-op

## Loading Flow (Full)

1. **Collect sources:**
   - Default directories: `~/.pi/agent/<type>/`, `./.pi/<type>/`
   - settings.json `<type>.paths`
   - CLI `--<type>` arguments

2. **Install remote sources:**
   - Process `npm:` and `git:` specifiers
   - Install to `~/.pi/agent/<type>/npm/` or `git/`

3. **Scan all sources:**
   - Recursively discover extensions
   - Compute relative path for each

4. **Apply filter:**
   - Combine settings.json `<type>.filter` and CLI `--<type>s` patterns
   - Filter by path (no loading yet)

5. **Load survivors:**
   - Parse/execute only extensions that passed filter
   - Validate (frontmatter, exports, schema)
   - Report errors for invalid extensions

---

# Implementation Plan

## Overview

This implementation consolidates four separate loading systems (hooks, tools, skills, themes) into a unified extension loading framework with shared logic for source resolution, installation, scanning, filtering, and loading.

## New Files

### `src/core/extensions/types.ts`
Extension type definitions shared across all loaders.

```typescript
export type ExtensionType = "hooks" | "tools" | "skills" | "themes";

export interface ExtensionSource {
  type: "file" | "directory" | "npm" | "git";
  specifier: string;        // original specifier from config/CLI
  resolvedPath?: string;    // resolved local path after install
}

export interface DiscoveredExtension {
  path: string;             // relative path (e.g., "brave-search", "npm/@scope/pkg@1.0.0")
  absolutePath: string;     // absolute filesystem path
  entryPoint: string;       // resolved entry point file
  source: ExtensionSource;
}

export interface ExtensionConfig {
  paths?: string[];
  filter?: string[];
}

export interface ExtensionTypeConfig {
  rootPatterns: string[];           // e.g., ["*.ts", "*.js"]
  subdirEntryPoints: string[];      // e.g., ["index.ts", "index.js"]
  packageJsonFallback: boolean;     // whether to check package.json main
}

export const EXTENSION_CONFIGS: Record<ExtensionType, ExtensionTypeConfig> = {
  hooks: {
    rootPatterns: ["*.ts", "*.js"],
    subdirEntryPoints: ["index.ts", "index.js"],
    packageJsonFallback: true,
    recursivePattern: false,
  },
  tools: {
    rootPatterns: ["*.ts", "*.js"],
    subdirEntryPoints: ["index.ts", "index.js"],
    packageJsonFallback: true,
    recursivePattern: false,
  },
  skills: {
    rootPatterns: ["*.md"],
    subdirEntryPoints: ["SKILL.md"],
    packageJsonFallback: false,
    recursivePattern: false,
  },
  themes: {
    rootPatterns: ["*.theme.json"],
    subdirEntryPoints: [],              // not used
    packageJsonFallback: false,
    recursivePattern: true,             // scan for *.theme.json at all levels
  },
};
```

### `src/core/extensions/source-resolver.ts`
Handles parsing and installing npm/git sources.

```typescript
export function parseSource(specifier: string): ExtensionSource;
export type InstallLocation = "cli" | "global" | "project";

export async function installSource(
  source: ExtensionSource,
  type: ExtensionType,
  location: InstallLocation,
  cwd: string,                  // needed for project-local installs
): Promise<string>;
export function isRemoteSource(specifier: string): boolean;
export function getInstallDir(type: ExtensionType, location: InstallLocation, cwd: string): string;
```

Key functions:
- `parseNpmSpecifier(spec)`: Parse `npm:@scope/pkg@1.2.3` → `{ name, version }`
- `parseGitSpecifier(spec)`: Parse `git:url@tag` or `git:url#branch`
- `installNpmPackage(name, version, targetDir)`: `npm pack` + extract + `npm install`
- `installGitRepo(url, ref, targetDir)`: `git clone` + checkout + `npm install`
- `getTargetDir(type, ephemeral)`: Returns temp dir or agent dir based on source

### `src/core/extensions/scanner.ts`
Unified recursive scanning for all extension types.

```typescript
export function scanDirectory(
  baseDir: string,
  config: ExtensionTypeConfig,
): DiscoveredExtension[];

export function resolveEntryPoint(
  dir: string,
  config: ExtensionTypeConfig,
): string | null;

export function getRelativePath(
  absolutePath: string,
  baseDir: string,
  config: ExtensionTypeConfig,
): string;  // strips entry point filename and extension
```

### `src/core/extensions/filter.ts`
Filter logic using glob patterns with `!` exclusion. Matches against `extension.path`.

```typescript
export function applyFilter(
  extensions: DiscoveredExtension[],
  patterns: string[],
): DiscoveredExtension[];

export function parseFilterPatterns(patterns: string[]): {
  include: string[];
  exclude: string[];
};

export function matchesPattern(path: string, pattern: string): boolean;
```

### `src/core/extensions/loader.ts`
Main entry point coordinating the full loading flow.

```typescript
export interface LoadExtensionsOptions {
  type: ExtensionType;
  cwd: string;
  agentDir: string;
  globalPaths: string[];              // from global settings.json → install to agentDir
  projectPaths: string[];             // from project settings.json → install to cwd/.pi/
  cliPaths: string[];                 // from CLI flags → install to /tmp/
  filter: string[];                   // combined filter patterns
}

export interface LoadExtensionsResult<T> {
  extensions: T[];
  errors: Array<{ path: string; error: string }>;
}

export async function discoverExtensions(
  options: LoadExtensionsOptions,
): Promise<DiscoveredExtension[]>;
```

### `src/core/extensions/index.ts`
Public exports.

## Modified Files

### `src/config.ts`

Add directory getters:

```typescript
export function getHooksDir(): string {
  return join(getAgentDir(), "hooks");
}

export function getSkillsDir(): string {
  return join(getAgentDir(), "skills");
}

// getToolsDir() already exists
// getThemesDir() = bundled themes (in package)
// getCustomThemesDir() = ~/.pi/agent/themes/ (user themes) - already exists
```

### `src/core/settings-manager.ts`

Update `Settings` interface:

```typescript
// Old:
hooks?: string[];
customTools?: string[];
skills?: SkillsSettings;

// New:
hooks?: ExtensionConfig;
tools?: ExtensionConfig;
skills?: ExtensionConfig;  // simplified from SkillsSettings
themes?: ExtensionConfig;
```

Add migration logic for old format:

```typescript
function migrateSettings(settings: unknown): Settings {
  // Convert hooks: string[] → hooks: { paths: string[] }
  // Convert customTools: string[] → tools: { paths: string[] }
  // Convert skills.customDirectories → skills.paths
  // Convert skills.includeSkills/ignoredSkills → skills.filter
}
```

Add unified getters:

```typescript
getExtensionConfig(type: ExtensionType): ExtensionConfig;
getExtensionPaths(type: ExtensionType): string[];
getExtensionFilter(type: ExtensionType): string[];
```

Update merge logic (paths are additive, filter overrides):

```typescript
function mergeExtensionConfig(global: ExtensionConfig, project: ExtensionConfig): ExtensionConfig {
  return {
    paths: [...(global.paths ?? []), ...(project.paths ?? [])],  // additive
    filter: project.filter ?? global.filter,                      // override
  };
}
```

### `src/cli/args.ts`

Update `Args` interface:

```typescript
// Built-in tools (unchanged)
tools?: ToolName[];          // --tools read,bash,edit,write

// Source flags
hooks?: string[];            // --hook (existing, repeatable)
customTools?: string[];      // --tool (existing, repeatable)
skills?: string[];           // --skill (new, repeatable)
themes?: string[];           // --theme (new, repeatable)

// Filter flags
hooksFilter?: string[];      // --hooks "patterns"
customToolsFilter?: string[];// --custom-tools "patterns"
skillsFilter?: string[];     // --skills "patterns" (existing)
themesFilter?: string[];     // --themes "patterns"

// Disable flags
noHooks?: boolean;           // --no-hooks
noCustomTools?: boolean;     // --no-custom-tools
noSkills?: boolean;          // --no-skills (existing)
```

Update argument parsing:

```typescript
// --tools (built-in tools, unchanged)
} else if (arg === "--tools" && i + 1 < args.length) {
  // ... existing logic for built-in tools

// --tool (add custom tool source)
} else if (arg === "--tool" && i + 1 < args.length) {
  result.customTools = result.customTools ?? [];
  result.customTools.push(args[++i]);

// --custom-tools (filter custom tools)
} else if (arg === "--custom-tools" && i + 1 < args.length) {
  result.customToolsFilter = args[++i].split(",").map(s => s.trim());

// --no-custom-tools
} else if (arg === "--no-custom-tools") {
  result.noCustomTools = true;

// --skill (add source) - new
} else if (arg === "--skill" && i + 1 < args.length) {
  result.skills = result.skills ?? [];
  result.skills.push(args[++i]);

// --theme (add source) - new  
} else if (arg === "--theme" && i + 1 < args.length) {
  result.themes = result.themes ?? [];
  result.themes.push(args[++i]);

// --themes (filter) - new
} else if (arg === "--themes" && i + 1 < args.length) {
  result.themesFilter = args[++i].split(",").map(s => s.trim());

// --hooks (filter) - new
} else if (arg === "--hooks" && i + 1 < args.length) {
  result.hooksFilter = args[++i].split(",").map(s => s.trim());

// --no-hooks - new
} else if (arg === "--no-hooks") {
  result.noHooks = true;
```

Add subcommand handling for `pi install`, `pi remove`, `pi update`.

### `src/core/hooks/loader.ts`

Refactor to use extension system:

```typescript
import { discoverExtensions, type DiscoveredExtension } from "../extensions/index.js";

export async function discoverAndLoadHooks(
  options: {
    cwd: string;
    agentDir?: string;
    configuredPaths?: string[];
    cliPaths?: string[];
    filter?: string[];
  }
): Promise<LoadHooksResult> {
  const discovered = await discoverExtensions({
    type: "hooks",
    defaultDirs: [join(agentDir, "hooks"), join(cwd, ".pi", "hooks")],
    configuredPaths: options.configuredPaths ?? [],
    cliPaths: options.cliPaths ?? [],
    filter: options.filter ?? [],
  });

  // Load each discovered hook using existing jiti logic
  const results = await Promise.all(
    discovered.map(ext => loadHook(ext.entryPoint, cwd))
  );
  
  // ... rest of existing logic
}
```

Remove duplicate code:
- `expandPath()` → use from extensions/source-resolver.ts
- `resolveHookPath()` → use from extensions/scanner.ts
- Discovery logic → use discoverExtensions()

### `src/core/custom-tools/loader.ts`

Same refactoring pattern as hooks/loader.ts.

### `src/core/skills.ts`

Refactor `loadSkills()` and `loadSkillsFromDir()`:

```typescript
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
  const discovered = await discoverExtensions({
    type: "skills",
    defaultDirs: [
      // existing default dirs
      join(homedir(), ".codex", "skills"),
      join(homedir(), ".claude", "skills"),
      join(agentDir, "skills"),
      join(cwd, ".pi", "skills"),
    ],
    configuredPaths: options.paths ?? [],
    cliPaths: options.cliPaths ?? [],
    filter: options.filter ?? [],
  });

  // Load each discovered skill using existing parsing logic
  // ...
}
```

Remove:
- `loadSkillsFromDirInternal()` recursive logic → use scanner.ts
- `matchesIncludePatterns()`/`matchesIgnorePatterns()` → use filter.ts

### `src/modes/interactive/theme/theme.ts`

Refactor `getAvailableThemes()` and `loadThemeJson()`:

```typescript
export function getAvailableThemes(): string[] {
  const discovered = discoverExtensions({
    type: "themes",
    defaultDirs: [getThemesDir(), getCustomThemesDir()],
    configuredPaths: settingsManager.getExtensionPaths("themes"),
    cliPaths: [],  // from args
    filter: settingsManager.getExtensionFilter("themes"),
  });

  return discovered.map(ext => ext.path);
}
```

### `src/core/sdk.ts`

Update to pass new options structure:

```typescript
// Hooks
const { hooks, errors } = await discoverAndLoadHooks({
  cwd,
  agentDir,
  configuredPaths: settingsManager.getExtensionPaths("hooks"),
  cliPaths: options.additionalHookPaths,
  filter: [...settingsManager.getExtensionFilter("hooks"), ...(options.hooksFilter ?? [])],
});

// Tools
const result = await discoverAndLoadCustomTools({
  cwd,
  agentDir,
  configuredPaths: settingsManager.getExtensionPaths("tools"),
  cliPaths: options.additionalToolPaths,
  filter: [...settingsManager.getExtensionFilter("tools"), ...(options.toolsFilter ?? [])],
  builtInToolNames: Object.keys(allTools),
});
```

### `src/modes/interactive/interactive-mode.ts`

Update skill loading to use new options structure.

## Migration & Backwards Compatibility

### Settings Migration

When loading settings.json, detect old format and migrate:

```typescript
// Old format detection
if (Array.isArray(settings.hooks)) {
  settings.hooks = { paths: settings.hooks };
}
if (Array.isArray(settings.customTools)) {
  settings.tools = { paths: settings.customTools };
  delete settings.customTools;
}
if (settings.skills?.customDirectories) {
  settings.skills.paths = settings.skills.customDirectories;
  delete settings.skills.customDirectories;
}
// ... etc
```

### CLI Compatibility

- `--tools` with built-in tool names still works (detected by checking if values match known tool names)
- Alternatively, deprecation warning and suggest `--builtin-tools`

## Implementation Order

1. **Phase 1: Core extension framework**
   - Create `src/core/extensions/` directory
   - Implement types.ts, scanner.ts, filter.ts
   - Unit tests for scanning and filtering

2. **Phase 2: Source resolution**
   - Implement source-resolver.ts (npm + git)
   - Add `npm pack` and `git clone` logic
   - Unit tests for source parsing and installation

3. **Phase 3: Settings migration**
   - Update settings-manager.ts with new types
   - Add migration logic
   - Update config.ts with new directory getters

4. **Phase 4: Refactor loaders**
   - Refactor hooks/loader.ts
   - Refactor custom-tools/loader.ts
   - Refactor skills.ts
   - Refactor theme.ts
   - Remove duplicate code

5. **Phase 5: CLI updates**
   - Add new flags to args.ts
   - Update help text
   - Add `pi install`, `pi remove`, `pi update` subcommands

6. **Phase 6: Integration**
   - Update sdk.ts
   - Update interactive-mode.ts
   - End-to-end testing

7. **Phase 7: Documentation**
   - Update README.md
   - Update docs/hooks.md, docs/custom-tools.md
   - Add examples for npm/git extensions

## Testing Strategy

### Unit Tests
- `test/extensions/scanner.test.ts`: Directory scanning, entry point resolution
- `test/extensions/filter.test.ts`: Pattern matching, include/exclude logic
- `test/extensions/source-resolver.test.ts`: npm/git specifier parsing

### Integration Tests
- `test/extensions/npm-install.test.ts`: Full npm package installation flow
- `test/extensions/git-clone.test.ts`: Full git repository cloning flow
- `test/extensions/loading.test.ts`: End-to-end extension discovery and loading

### Migration Tests
- `test/settings-migration.test.ts`: Old → new settings format conversion

## File Summary

### New Files (7)
- `src/core/extensions/types.ts`
- `src/core/extensions/source-resolver.ts`
- `src/core/extensions/scanner.ts`
- `src/core/extensions/filter.ts`
- `src/core/extensions/loader.ts`
- `src/core/extensions/index.ts`
- `docs/extension-loading.md` (this file)

### Modified Files (9)
- `src/config.ts` - add directory getters
- `src/core/settings-manager.ts` - new types, migration
- `src/cli/args.ts` - new flags, update parsing
- `src/core/hooks/loader.ts` - refactor to use extensions
- `src/core/custom-tools/loader.ts` - refactor to use extensions
- `src/core/skills.ts` - refactor to use extensions
- `src/modes/interactive/theme/theme.ts` - refactor to use extensions
- `src/core/sdk.ts` - update option passing
- `src/modes/interactive/interactive-mode.ts` - update skill loading

### Deleted Code (moved to extensions/)
- Duplicate `expandPath()`, `normalizeUnicodeSpaces()` functions
- Duplicate discovery/scanning logic
- Duplicate path resolution logic
