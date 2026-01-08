# Pi Coding Agent: Update Experience Analysis

## Current State

Pi currently:
1. Checks npm registry on startup (async, non-blocking)
2. Shows a notification: "New version X is available. Run: npm install -g @mariozechner/pi-coding-agent"
3. User must manually copy/paste or type the npm command

## How Other CLI Tools Handle Updates

### Claude Code
- **`claude update`** - dedicated CLI subcommand
- **Native installer** (curl script) - supports auto-updates
- **npm install** - requires manual `npm i -g @anthropic-ai/claude-code@latest`
- `claude doctor` shows if auto-updates are enabled

### OpenCode
- **`opencode upgrade [target]`** - dedicated CLI subcommand
  - Supports version targeting: `opencode upgrade 0.1.48`
  - Supports install method selection: `--method curl|npm|pnpm|bun|brew`
- **Auto-update on startup** - configurable via `autoupdate` in config:
  - `true` - automatically downloads updates on startup
  - `"notify"` - just notifies when new version available
  - `false` - no update checks
- Native binary (Bun-compiled)

### OpenAI Codex CLI
- **Manual only** - `npm i -g @openai/codex@latest`
- No update command or auto-update

### Gemini CLI
- **Manual only** - `npm install -g @google/gemini-cli@latest`
- No update command or auto-update

## Feature: `pi update`

### Spec

A CLI subcommand that updates pi to the latest version.

```bash
pi update
```

**Behavior:**
1. Check current version vs npm registry
2. If already on latest: print "Already on latest version (X.X.X)" and exit
3. If update available: print "Updating to X.X.X..."
4. Run `npm install -g @mariozechner/pi-coding-agent@latest`
5. On success: print "Updated to X.X.X" (could exec new `pi --version` to confirm)
6. On permission error: print helpful message with options
7. On other error: print error message

**Permission error handling:**
```
Permission denied. Try one of:
  - Run: sudo pi update
  - Fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally
```

**Startup notification update:**
Change from:
> "New version X is available. Run: npm install -g @mariozechner/pi-coding-agent"

To:
> "New version X is available. Run: pi update"

### Open Questions

1. **Auto-restart after update?** Could exec the new `pi` binary after successful update. Feels clean for CLI command. Or just print success and let user start fresh.

2. **Version targeting?** OpenCode supports `opencode upgrade 0.1.48`. Do we need this? Probably not for v1 - just update to latest.

---

## Phase 2: Auto-Update on Startup

### Settings

```typescript
// settings.json
{
  "autoupdate": "notify" | "prompt" | true | false
}
```

- `false` - no update checks
- `"notify"` - passive notification only (current default behavior)
- `"prompt"` - interactive prompt: "Update available (X.X.X). Update now? [y/N]"
- `true` - silent auto-install on startup

### The `"prompt"` Mode

Middle ground between passive notification and full auto-update:

**Current (`"notify"`):**
```
┌─ Update Available ─┐
│ New version 0.39.0 │
│ Run: pi update     │
└────────────────────┘
```
User flow: see notification → mentally note → exit later → run `pi update` → restart pi

**With `"prompt"`:**
```
Update available: 0.38.0 → 0.39.0
Update now? [y/N] _
```
User flow: see prompt → press y → updated → continues into TUI

This is more impactful because:
- User is about to work, update is top of mind
- One keystroke vs. exit + command + restart
- Still requires explicit consent (not silent like `true`)
- Default N means Enter skips it quickly

### Constraints

- Only in interactive mode (not `--print`, not RPC, not piped stdin)
- Runs early in startup, before TUI fully loads
- Must handle terminal state carefully (no TUI yet, just simple stdin prompt)

### Restart After Update

After `npm install`, running process is still old binary. Options:
1. **Exec new binary** - seamless, user gets new version immediately
2. **Continue + message** - awkward "restart to use"
3. **Exit with message** - interrupts flow

For `"prompt"` and `true` modes: use (1) - exec new `pi` with same args.
For `pi update` CLI: just print success, user starts fresh anyway.

### Failure Handling

- Permission error → show message: "Update failed (permission denied). Run: `sudo pi update`"
- Network/timeout → silently continue, don't block startup
- For `"prompt"` mode: on failure, fall back to showing notification

### Default Value

`"notify"` as default (conservative, current behavior). 

### Prompting to Enable Auto-Updates

**Option A: After successful `pi update`**
- "Enable auto-updates? [y/N]"
- Feels naggy - user just did the manual thing

**Option B: Never prompt, just document**
- Users who want auto-updates can set it in settings.json
- Less intrusive

**Option C: First-run only**
- On very first launch, ask about preferences
- But this delays getting to work

Leaning toward **Option B** - just document it well. Users who care will find the setting.

---

## Installation Methods (Future)

**Current state:** npm only, so `pi update` just runs `npm install -g`.

**Future:** When we distribute via pnpm, bun, brew, etc., we'll need to:
- Detect install method (path heuristics or `installMethod` setting)
- Run the appropriate update command

For now, there's a TODO comment in `update.ts` about this.

## Implementation Plan

### Phase 1: `pi update` ✅

1. Add `update` check early in CLI entry point (before TUI/agent starts)
2. Implement update logic in `src/cli/update.ts`:
   - Check npm registry for latest version
   - Run `npm install -g <package>@latest`
   - Handle errors gracefully (permission, network)
3. Update startup notification text to mention `pi update`

### Phase 2: Auto-Update (Future)

1. Add `autoupdate` setting: `false | "notify" | "prompt" | true`
2. On interactive startup:
   - `"prompt"`: show "Update now? [y/N]" before TUI loads
   - `true`: run update silently
   - On success: exec new binary with same args
   - On failure: fall back to notify mode
3. Document the setting well (no intrusive prompts to enable it)

## Implementation Status

**Phase 1:** ✅ Done
- `src/cli/update.ts` - update logic
- `src/cli.ts` - intercepts `update` command
- `src/cli/args.ts` - added to help text
- Startup notification updated to say "Run: pi update"

**Phase 2:** Not started
