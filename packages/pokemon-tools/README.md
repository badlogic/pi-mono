# @mariozechner/pi-pokemon-tools

Pi package that adds:

- a `pokemon` tool for driving a local `pokemon-agent` server
- a `/pokemon` slash command for common session actions
- a bundled `pokemon-player` skill for autonomous gameplay loops

## Install

```bash
pi install /absolute/path/to/packages/pokemon-tools
```

## Tool actions

- `setup`: validate Python, `pokemon-agent`, `pyboy`, and an optional ROM path
- `info`: inspect a ROM via `pokemon-agent info`
- `start`: launch a detached `pokemon-agent serve` process and wait for `/health`
- `status`: inspect the current session and clear stale metadata automatically
- `state`, `action`, `screenshot`, `save`, `load`, `saves`, `minimap`, `stop`: proxy the upstream HTTP API

Session metadata is stored under `~/.pi/agent/tools/pokemon-agent/`.

## Session model

A session name is the emulator workspace for one running game.

- session name = process handle + data dir + metadata/log files
- save name = checkpoint inside that session

Example:

```bash
/pokemon start --session yellow-test --rom "/absolute/path/to/Pokemon Yellow.gb"
```

That session will keep its own:

- metadata file: `~/.pi/agent/tools/pokemon-agent/yellow-test.json`
- log file: `~/.pi/agent/tools/pokemon-agent/yellow-test.log`
- data dir: `~/.pi/agent/tools/pokemon-agent/data/yellow-test`

## Common commands

Stop a running session cleanly:

```bash
/pokemon stop --session yellow-test
```

Save before stopping:

```bash
/pokemon save session-end --session yellow-test
/pokemon stop --session yellow-test
```

List available saves:

```bash
/pokemon saves --session yellow-test
```

Load a save later:

```bash
/pokemon load session-end --session yellow-test
```

Continue inspecting a running game:

```bash
/pokemon status --session yellow-test
/pokemon state --session yellow-test
/pokemon screenshot --session yellow-test
```

## Clean slate

The easiest clean slate is a new session name:

```bash
/pokemon start --session yellow-fresh --rom "/absolute/path/to/Pokemon Yellow.gb"
```

That gives you a separate data dir and separate save set without touching the old run.

If you want to fully wipe a session later:

1. Stop it.
2. Delete:
   - `~/.pi/agent/tools/pokemon-agent/<session>.json`
   - `~/.pi/agent/tools/pokemon-agent/<session>.log`
   - `~/.pi/agent/tools/pokemon-agent/data/<session>`

## Notes

- This package never downloads or distributes ROMs.
- Users must provide a legal local ROM path.
- The runtime prefers a dedicated Pokemon venv at `~/.pi/agent/tools/pokemon-agent/.venv` when present.
- ROM paths can omit the file extension; the tool will also try `.gb`, `.gbc`, and `.gba`.
- Decompilation repos such as `pret/pokered`, `pret/pokefirered`, and `pret/pokeemerald` are useful references, but they are not a substitute for a playable ROM.
- If the upstream dashboard is installed, results include its URL. The package does not embed a browser UI.
