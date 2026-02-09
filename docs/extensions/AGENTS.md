# Extension Development Guide

This AGENTS.md applies to files in `/docs/extensions/`.

## Principles

- **Upstream-first**: Most documentation lives at `packages/coding-agent/docs/extensions.md` - prefer linking over duplicating
- **Practical focus**: Docs should answer "how do I do X" with working examples
- **Type-driven**: Reference types in `packages/coding-agent/src/core/extensions/types.ts` for accuracy
- **Example-powered**: Link to `packages/coding-agent/examples/extensions/` for reference implementations

## Working with Extension Docs

When updating extension docs:
1. Check upstream documentation first (`packages/coding-agent/docs/`)
2. Verify types against source (don't guess signatures)
3. Test code examples against real extensions
4. Keep sections focused and cross-link rather than duplicate

## Key Files

| Path | Purpose |
|------|---------|
| `packages/coding-agent/src/core/extensions/types.ts` | Extension types and events |
| `packages/coding-agent/docs/extensions.md` | Comprehensive upstream docs |
| `packages/coding-agent/examples/extensions/` | Working examples |
| `packages/coding-agent/examples/extensions/README.md` | Example catalog |

## Common Tasks

**Add a new event example**: Find the event in `types.ts`, add pattern to `events.md`

**Document a new pattern**: Check `examples/extensions/` for reference, add to relevant guide

**Verify API**: Check types in `extensions/types.ts` before documenting signatures

## Commands

- Test examples: `pi -e ./packages/coding-agent/examples/extensions/<name>.ts`
- Typecheck: `npm run check` (from repo root)
