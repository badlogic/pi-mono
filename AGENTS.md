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
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional

## Commands
- After code changes: `npm run check` (get full output, no tail)
- NEVER run: `npm run dev`, `npm run build`, `npm test`
- Only run specific tests if user instructs: `npm test -- test/specific.test.ts`
- NEVER commit unless user asks

## GitHub Issues
When reading issues:
- Always read all comments on the issue

When creating issues:
- Add `pkg:*` labels to indicate which package(s) the issue affects
  - Available labels: `pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:mom`, `pkg:pods`, `pkg:proxy`, `pkg:tui`, `pkg:web-ui`
- If an issue spans multiple packages, add all relevant labels

When closing issues via commit:
- Include `fixes #<number>` or `closes #<number>` in the commit message
- This automatically closes the issue when the commit is merged

## Tools
- GitHub CLI for issues/PRs
- Add package labels to issues/PRs: pkg:agent, pkg:ai, pkg:coding-agent, pkg:mom, pkg:pods, pkg:proxy, pkg:tui, pkg:web-ui
- TUI interaction: use tmux

## Style
- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Changelog
Location: `packages/coding-agent/CHANGELOG.md`, `packages/ai/CHANGELOG.md`, `packages/tui/CHANGELOG.md`, pick the one relevant to the changes or ask user.
- New entries ALWAYS go under `## [Unreleased]` section
- NEVER modify already-released version sections (e.g., `## [0.12.2]`)
- Each version section is immutable once released
- When releasing: rename `[Unreleased]` to the new version, then add a fresh empty `[Unreleased]` section

### Attribution format
- **Internal changes (from issues)**: Reference issue only
  - Example: `Fixed foo bar ([#123](https://github.com/badlogic/pi-mono/issues/123))`
- **External contributions (PRs from others)**: Reference PR and credit the contributor
  - Example: `Added feature X ([#456](https://github.com/badlogic/pi-mono/pull/456) by [@username](https://github.com/username))`
- If a PR addresses an issue, reference both: `([#123](...issues/123), [#456](...pull/456) by [@user](...))` or just the PR if the issue context is clear from the description

## Releasing

1. **Bump version** (all packages use lockstep versioning):
   ```bash
   npm run version:patch    # For bug fixes
   npm run version:minor    # For new features
   npm run version:major    # For breaking changes
   ```

2. **Finalize CHANGELOG.md**: Change `[Unreleased]` to the new version with today's date (e.g., `## [0.12.12] - 2025-12-05`)

3. **Commit and tag**:
   ```bash
   git add .
   git commit -m "Release v0.12.12"
   git tag v0.12.12
   git push origin main
   git push origin v0.12.12
   ```

4. **Publish to npm**:
   ```bash
   npm run publish
   ```

5. **Add new [Unreleased] section** at top of CHANGELOG.md for next cycle, commit it

**CTRICIAL**: NEVER use sed/cat to read a file or a range of a file. Always use the read tool (use offset + limit for ranged reads).