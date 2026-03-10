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

## Notes

- This package never downloads or distributes ROMs.
- Users must provide a legal local ROM path.
- If the upstream dashboard is installed, results include its URL. The package does not embed a browser UI.
