---
name: pokemon-player
description: Play Pokemon games through the local pokemon tool. Start a pokemon-agent session, inspect state, send actions, capture screenshots, and manage saves without raw curl commands.
tags: [gaming, pokemon, emulator, pyboy, gameplay]
triggers:
  - play pokemon
  - pokemon game
  - start pokemon
  - play pokemon red
  - play pokemon firered
  - pokemon firered
  - pokemon red
  - play gameboy
---

# Pokemon Player Skill

Play Pokemon autonomously through the `pokemon` tool.

## Invocation Rule

If this skill is invoked directly without an accompanying user message, treat that as an explicit request to start the Pokemon workflow.

- Do not ask what project, codebase, or task the user wants to work on.
- Start by running `pokemon` with action `setup`.
- If a ROM path is missing, ask only for the legal local ROM path.
- Once a ROM path is available, continue with the normal startup flow.

## Guardrails

- The package never downloads or distributes ROMs.
- Ask the user for a legal local ROM path if they have not provided one.
- Prefer a named session when the user wants to keep multiple runs.
- If the user gives a ROM path without an extension, try it as-is and then common ROM suffixes such as `.gb`, `.gbc`, and `.gba`.

## First-Time Setup

Run `pokemon` with action `setup`.

If setup reports missing dependencies, tell the user exactly what is missing. The expected Python install is:

```bash
pip install pokemon-agent[dashboard] pyboy
```

Prefer a dedicated Pokemon venv when possible. The package looks for:

- `~/.pi/agent/tools/pokemon-agent/.venv`
- `POKEMON_AGENT_PYTHON` if explicitly set

## Starting a Session

1. Ask for a ROM path if it is missing.
2. Run `pokemon` with action `start`, `romPath`, and optionally `session`, `port`, `dataDir`, or `loadState`.
3. Tell the user about the dashboard URL when the tool reports one.

Mental model:

- session name = emulator workspace
- save name = checkpoint inside that workspace

If the user wants a clean slate, prefer a new session name over deleting old data immediately.

## Gameplay Loop

Each turn:

1. Observe with `pokemon` action `state`.
2. Decide on the next objective.
3. Act with `pokemon` action `action` and an `actions` array.
4. Verify from `state_after` or by checking `state` again.

If the screen is ambiguous, call `pokemon` with action `screenshot` and inspect the returned image.

## Priority Order

1. If dialog is active, use `a_until_dialog_end`.
2. If in battle, choose the best move or save/load around risky encounters.
3. If the team needs healing, route toward a Pokemon Center.
4. If a gym or key progression goal is ready, advance that objective.
5. Otherwise explore, train, or catch useful Pokemon.

## Action Reference

- `press_a`: confirm, talk, interact
- `press_b`: cancel, back out, attempt to run
- `press_start`: open menu
- `press_select`: select button
- `walk_up`, `walk_down`, `walk_left`, `walk_right`: move one tile
- `wait_60`: wait about one second
- `a_until_dialog_end`: mash A until dialog finishes
- `hold_a_30`: hold A for 30 frames

## Battle Strategy

Use simple Gen 1 priorities for Red/Blue-style runs:

- Prefer super-effective damaging moves.
- Switch or play conservatively when at a strong type disadvantage.
- Save before gym leaders, rare encounters, and dungeons.
- Use Pokeballs when a desired target is weak enough to catch.

Key matchups:

- Water beats Fire, Ground, Rock.
- Fire beats Grass, Bug, Ice.
- Grass beats Water, Ground, Rock.
- Electric beats Water, Flying.
- Ground beats Fire, Electric, Rock, Poison.
- Psychic is unusually strong in Gen 1.

For GBA runs such as Emerald, treat those Gen 1 notes as a loose fallback only. Prefer current state, move effectiveness, and safer exploration over Gen 1-specific assumptions.

## Reference Material

Use repo references as supporting context, not as a ROM replacement:

- `pret/pokered`: useful for Gen 1 maps, memory notes, and progression references
- `pret/pokefirered`: useful for FireRed/LeafGreen internals
- `pret/pokeemerald`: useful for Emerald-specific mechanics and map/progression references

These decompilation projects help with reasoning about the game state, but the emulator still requires a legal local ROM file to run.

## Save Discipline

Use `pokemon` action `save` before:

- gym battles
- rival fights
- rare encounters
- dungeon entries

If you get stuck or lose a key battle, use `pokemon` action `load`.
Use `pokemon` action `saves` to confirm available restore points.

## Memory Conventions

Track long-term progress in memory with these prefixes when a memory tool is available:

- `PKM:OBJECTIVE:`
- `PKM:MAP:`
- `PKM:STRATEGY:`
- `PKM:PROGRESS:`
- `PKM:STUCK:`

Example entries:

- `PKM:OBJECTIVE: Defeat Brock in Pewter City`
- `PKM:MAP: Viridian Forest exits north into Pewter City`
- `PKM:STRATEGY: Brock is weak to Water and Grass`

## Progression Milestones

Track completion of major milestones:

1. Get the starter Pokemon.
2. Deliver Oak's Parcel and receive the Pokedex.
3. Reach Pewter City.
4. Beat Brock for the Boulder Badge.
5. Reach Cerulean through Mt. Moon.
6. Beat Misty for the Cascade Badge.
7. Board the SS Anne and get HM01 Cut.
8. Beat Lt. Surge for the Thunder Badge.

## Recovery Rules

If state does not change after several actions:

1. Try `press_b` to exit menus.
2. Try a different direction.
3. Check `minimap` and `state`.
4. Load the most recent safe save if necessary.

## Ending a Session

1. Save with a clear slot name such as `session-end`.
2. Summarize progress for the user.
3. Stop the server with `pokemon` action `stop`.

If the user asks how to clean up fully, explain that they can:

1. Stop the session.
2. Delete the session metadata file, log file, and session data directory under `~/.pi/agent/tools/pokemon-agent/`.
