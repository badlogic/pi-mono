# Development Rules

## First Message
If the user did not give you a concrete task in their first message,
read README.md, then ask which module(s) to work on. Based on the answer, read the relevant README.md files in parallel.
- packages/ai/README.md
- packages/tui/README.md
- packages/agent/README.md
- packages/coding-agent/README.md
- packages/mom/README.md
- packages/pods/README.md
- packages/web-ui/README.md

## Code Quality
- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- No inline imports like `await import("./foo.js")`

## Commands
- After code changes: `npm run check` (get full output, no tail)
- NEVER run: `npm run dev`, `npm run build`
- NEVER commit unless user asks

## GitHub Issues

When creating issues:
- Add `pkg:*` labels to indicate which package(s) the issue affects
  - Available labels: `pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:mom`, `pkg:pods`, `pkg:proxy`, `pkg:tui`, `pkg:web-ui`
- If an issue spans multiple packages, add all relevant labels

## Tools
- GitHub CLI for issues/PRs
- Add package labels to issues/PRs: pkg:agent, pkg:ai, pkg:coding-agent, pkg:mom, pkg:pods, pkg:proxy, pkg:tui, pkg:web-ui
- Browser tools (~/agent-tools/browser-tools/README.md): browser automation for frontend testing, web searches, fetching documentation
- TUI interaction: use tmux

## Style
- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Changelog
- New entries ALWAYS go under `## [Unreleased]` section
- NEVER modify already-released version sections (e.g., `## [0.12.2]`)
- Each version section is immutable once released
- When releasing: rename `[Unreleased]` to the new version, then add a fresh empty `[Unreleased]` section
