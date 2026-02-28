# Overview

Set up a Docusaurus documentation site at `docs/` that reads markdown content directly from `packages/coding-agent/` without moving or modifying any documentation files. A custom remark plugin embeds `.ts` example files as inline collapsible code blocks and strips links to source code files that aren't part of the docs site.

# Architecture

Docusaurus project at `docs/` as a new npm workspace. The `@docusaurus/plugin-content-docs` plugin uses the `path` option to point at `../packages/coding-agent/`, reading all markdown files from their current locations. A custom remark plugin handles links at build time: `.ts` example files get embedded inline, source code links get stripped (text preserved, link removed), and doc-to-doc links are left for Docusaurus to resolve natively.

# Tech Stack

- Docusaurus 3
- Custom remark plugin (remark/unified AST)

# Implementation plan

## 1. Docusaurus project setup

Create `docs/` with standard Docusaurus 3 files. Add `"docs"` to root `package.json` workspaces. Add `docs/build/`, `docs/.docusaurus/` to `.gitignore`.

## 2. Docusaurus configuration

```js
// docs/docusaurus.config.js
module.exports = {
  title: "pi",
  url: "https://pi.dev",
  baseUrl: "/docs/",
  plugins: [
    [
      "@docusaurus/plugin-content-docs",
      {
        path: "../packages/coding-agent",
        routeBasePath: "/",
        exclude: [
          "src/**",
          "dist/**",
          "test/**",
          "node_modules/**",
          "examples/extensions/subagent/agents/**",
          "examples/extensions/subagent/prompts/**",
          "examples/extensions/dynamic-resources/SKILL.md",
          "examples/extensions/dynamic-resources/dynamic.md",
        ],
        remarkPlugins: [require("./src/plugins/remark-resolve-links")],
      },
    ],
  ],
};
```

- `path: '../packages/coding-agent'` — reads content from the package dir
- `routeBasePath: '/'` — README.md becomes the landing page
- `exclude` — filters out non-documentation markdown

## 3. Custom remark plugin

**`docs/src/plugins/remark-resolve-links.js`**

Walks the markdown AST during build. Receives the source file path via the vfile object. Classifies each link by resolving its href relative to the source file:

1. **Example `.ts` links** (resolved path falls under `examples/` and ends with `.ts`):
   - Read the file content from disk
   - Replace the link node with a collapsible `<details>` containing a fenced TypeScript code block
   - `<summary>` shows the original link text

2. **Source code / out-of-tree links** (resolved path falls under `src/`, `test/`, or goes above `packages/coding-agent/`):
   - Strip the link — keep the display text as plain text, remove the `href`
   - These will be replaced with API reference links in a future step

3. **Directory links** (href ends with `/`):
   - Strip the link, keep display text

4. **Doc-to-doc `.md` links** (resolved path is within the content tree and ends with `.md`):
   - Leave untouched — Docusaurus handles these natively

## 4. Non-doc markdown exclusions

Excluded via Docusaurus config `exclude`:

- `src/**`, `dist/**`, `test/**`, `node_modules/**`
- `examples/extensions/subagent/agents/*.md` — agent prompt files
- `examples/extensions/subagent/prompts/*.md` — prompt template files
- `examples/extensions/dynamic-resources/SKILL.md`, `dynamic.md`

## 5. Sidebar

```js
// docs/sidebars.js
module.exports = {
  docs: [
    { type: "doc", id: "README", label: "Overview" },
    {
      type: "category",
      label: "Guides",
      items: [
        "docs/providers",
        "docs/models",
        "docs/settings",
        "docs/keybindings",
        "docs/session",
        "docs/compaction",
        "docs/prompt-templates",
        "docs/skills",
        "docs/windows",
        "docs/termux",
        "docs/terminal-setup",
        "docs/shell-aliases",
      ],
    },
    {
      type: "category",
      label: "Extending",
      items: [
        "docs/extensions",
        "docs/tui",
        "docs/themes",
        "docs/packages",
        "docs/custom-provider",
      ],
    },
    {
      type: "category",
      label: "Integration",
      items: ["docs/sdk", "docs/rpc", "docs/json"],
    },
    {
      type: "category",
      label: "Examples",
      items: [
        "examples/README",
        "examples/extensions/README",
        "examples/extensions/doom-overlay/README",
        "examples/extensions/plan-mode/README",
        "examples/extensions/subagent/README",
        "examples/sdk/README",
      ],
    },
    { type: "doc", id: "docs/development", label: "Development" },
    { type: "doc", id: "CHANGELOG", label: "Changelog" },
  ],
};
```

## 6. Images

Referenced from README.md as `docs/images/interactive-mode.png`. Docusaurus resolves relative image paths within the content tree. If issues arise, add `../packages/coding-agent/docs/images` to `staticDirectories`.

# Files to modify

## New files

- **`docs/package.json`** — Docusaurus dependencies (`@docusaurus/core`, `@docusaurus/preset-classic`, `react`, `react-dom`)
- **`docs/docusaurus.config.js`** — docs plugin with path to `../packages/coding-agent`, exclude patterns, remark plugin
- **`docs/sidebars.js`** — navigation structure
- **`docs/src/css/custom.css`** — minimal styling
- **`docs/src/plugins/remark-resolve-links.js`** — custom remark plugin: embed `.ts` examples inline, strip source code links

## Modified files

- **`package.json`** (repo root) — add `"docs"` to `workspaces` array
- **`.gitignore`** (repo root) — add `docs/build/`, `docs/.docusaurus/`

## NOT modified

- No files in `packages/coding-agent/`
- No `packages/*/package.json` changes
- No runtime code changes

# Verification, success criteria

1. **npm package unchanged**: `cd packages/coding-agent && npm pack --dry-run` — verify docs/, examples/, README.md, CHANGELOG.md listed with same contents.

2. **No documentation files modified**: `git diff packages/coding-agent/` shows only TSDoc additions to `.ts` source files (if any), zero changes to `.md` files.

3. **Docusaurus builds**: `cd docs && npm install && npx docusaurus build` completes without errors.

4. **Local preview**: `cd docs && npx docusaurus start` and verify:
   - README.md renders as landing page with images
   - Sidebar shows all sections
   - Doc-to-doc links work (README → providers, extensions → tui)
   - `.ts` example files render as collapsible inline code blocks
   - Source code references show as plain text (no broken links)
   - CHANGELOG renders
   - Excluded files do NOT appear as pages

# Todo items

1. Create `docs/package.json` with Docusaurus 3 dependencies
2. Create `docs/docusaurus.config.js` — docs plugin pointing to `../packages/coding-agent`, exclude patterns, remark plugin
3. Create `docs/sidebars.js` — navigation structure
4. Create `docs/src/css/custom.css`
5. Write `docs/src/plugins/remark-resolve-links.js` — embed `.ts` examples, strip source/out-of-tree links
6. Add `"docs"` workspace to root `package.json`, update `.gitignore`
7. Run `npx docusaurus build` to verify site builds
8. Smoke test: preview, check links, images, code embeds, excluded pages
