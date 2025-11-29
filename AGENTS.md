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

## Tools
- GitHub CLI for issues/PRs
- Add package labels to issues/PRs: pkg:agent, pkg:ai, pkg:coding-agent, pkg:mom, pkg:pods, pkg:proxy, pkg:tui, pkg:web-ui
- Browser tools (~/agent-tools/browser-tools/README.md): browser automation for frontend testing, web searches, fetching documentation
- TUI interaction: use tmux

## Style
- Keep answers short and concise
