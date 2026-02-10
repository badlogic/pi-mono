# @mariozechner/pi-video-electron

Electron wrapper and runtime modules for building a video-editing agent on top of pi.

This package is designed to:
- Run `@mariozechner/pi-coding-agent` in Electron main process
- Delegate video operations to an external VotGO binary
- Persist project metadata and artifacts in `.pi-video/` inside each project
- Keep project media organized in dedicated `inputs/` and `outputs/` folders

## VotGO Location

Default VotGO repo path:

`/Users/francescooddo/Desktop/miniMaoMao/VotGO`

The package resolves a binary in this order:
1. Explicit `votgoBinaryPath` setting
2. `<votgoRepoPath>/bin/votgo`
3. `<votgoRepoPath>/votgo`
4. `votgo` from `PATH`

## Core Exports

- `VideoAgentController`: command-oriented runtime for UI transports
- `createVideoAgentSession`: creates a pi session with VotGO-backed tools
- `runVotgoCommand`: typed command runner for VotGO
- `openOrCreateVideoProject`: scans media files and writes `.pi-video/project.json`
- `saveTimelineArtifact`, `saveRecipeArtifact`: schema-validated artifact persistence
- `createVideoElectronApp`: Electron main-process bootstrap helper

## Build

```bash
npm run build
```

## Agent Edit Safety

- Mutating VotGO commands (for example `remove-silence`, `crop-bars`, `convert`, `extract-audio`, `agent-run`) are approval-gated by default in the Electron app.
- Transcript edit prompts like "cut repetitions and keep the last take" run as suggestion-first:
  - the app analyzes the transcript,
  - highlights suggested removals in the transcript UI,
  - then asks whether to apply immediately or keep suggestions only.
