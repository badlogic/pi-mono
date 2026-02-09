---
name: train-convo-steering
description: Voice-first runtime steering + nightly deep analysis to learn per-user conversation priors.
triggers:
  - train convo steering
  - runtime steering step
  - train steering nightly
---

# train-convo-steering (Skill v2)

Voice-first **runtime steering** + nightly **deep analysis** to learn per-user conversation steering priors.

This skill is designed for:

- **Live voice**: per-turn inference must be fast and bounded (preset selection, not multi-candidate judging).
- **Nightly deep learning**: optional DeepSeek V3 (TEE) judge calls to improve labels and update per-user priors.

## Concepts

### Collaboration State

A compact state bucket per turn (`tempo`, `trust`, `alignment`, `affect`, `control`) mapped to `{low, mid, high}`.

### Steering Presets

Configuration of response knobs (length, questions, initiative, certainty, grounding) and voice prosody.

- `fast_proceed`
- `clarify_once`
- `trust_repair`
- `deep_dive`
- `exec_summary_plus_steps`
- `socratic`

### Priors

Per-user policy map `state key -> best preset` learned from reinforcement signals (user feedback, latency, DeepSeek judge).

## Commands

### Runtime (voice-first)

```bash
./run.sh runtime-step \\
  --user-id <USER_ID> \\
  --session-id <SESSION_ID> \\
  --channel <text|voice> \\
  --user-text "..."
```

Emits JSON with the selected preset and decision details.

### Nightly

```bash
./run.sh nightly \\
  --logs ./_out/live_logs.jsonl \\
  --out ./_out
```

Processes logs, runs DeepSeek judge (if configured), and updates priors.

## Configuration

Set environment variables in `.env` (or project root):

- `DEESEEK_API_BASE`: Chutes API or gateway URL.
- `DEESEEK_API_KEY`: API Key.
- `DEESEEK_MODEL`: Model name (default `deepseek-v3`).
- `DEESEEK_JUDGE_ENABLED`: Set to `1` or `true` to enable.
