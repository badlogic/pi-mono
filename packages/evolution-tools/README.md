# @mariozechner/pi-evolution-tools

Pi package that adds:

- an `evolution` tool for bounded skill-evolution workflows
- a `/evolution` slash command
- a bundled `skill-evolution` skill

## Install

```bash
pi install /absolute/path/to/packages/evolution-tools
```

## Tool actions

- `setup`: validate Python, required Python packages, API credentials, and writable output roots
- `targets`: list skill targets from `~/.pi/agent/skills` and `<cwd>/.pi/skills`
- `init_dataset`: create dataset skeletons under `<cwd>/.pi/evolution/datasets/skills/<skill>/`
- `run`: execute the bundled Python helper against a skill and write outputs under `<cwd>/.pi/evolution/runs/<skill>/<timestamp>/`
- `status`: inspect the most recent run and surface metrics plus artifact paths

## Scope

- v1 only evolves `SKILL.md` files
- v1 never mutates live skills automatically
- users review candidates manually and apply them with normal edits or a separate skills workflow
