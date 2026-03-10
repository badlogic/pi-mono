---
name: skill-evolution
description: Evolve Pi skills through the local evolution tool. Discover skill targets, initialize datasets, run bounded DSPy-based optimization, and review saved candidates without mutating live skills automatically.
tags: [skills, optimization, dspy, evaluation]
triggers:
  - evolve this skill
  - optimize this skill
  - improve the skill instructions
  - run skill evolution
---

# Skill Evolution

Use the `evolution` tool when the user wants to improve a `SKILL.md` file while keeping the workflow bounded and reviewable.

## Scope

- v1 only supports `SKILL.md` targets.
- v1 never writes evolved text back into live skill roots.
- All outputs go under `<cwd>/.pi/evolution/`.

## Workflow

1. Run `evolution` action `targets` if the requested skill name might be ambiguous.
2. Run `evolution` action `setup` if Python, DSPy, or credentials may be missing.
3. If a golden dataset does not exist yet, run `evolution` action `init_dataset`.
4. Run `evolution` action `run` with:
   - `skillName`
   - optional `datasetPath`
   - optional `iterations`
   - optional `evalSource`
   - optional `optimizerModel`
   - optional `evalModel`
   - `dryRun: true` first when the user wants validation before a real run
5. Run `evolution` action `status` to inspect the latest saved metrics and artifact paths.

## Guardrails

- Keep the run bounded to a single skill at a time.
- Prefer `dryRun` before the first real run in a new workspace.
- Do not claim the candidate is live. It is only a saved artifact until a human reviews and applies it.
- Preserve the skill’s intent and frontmatter. The goal is a better implementation, not a different job.

## Review Checklist

After a run completes:

1. Inspect `baseline_skill.md` and `candidate_skill.md`.
2. Check `metrics.json` for improvement, constraints, and semantic preservation.
3. If the candidate is better, tell the user where the files are and offer to help apply the diff manually.
4. If the candidate is worse or rejected, summarize why and adjust dataset/model/iteration settings before trying again.
