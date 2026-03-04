# Find Plan File

Based on the `Previous Step Output` below, follow the `Instructions` to find the path to the plan file that was just created.

## Instructions

- The previous step created a plan file. Find the exact file path.
- You can use these approaches to find it:
  - Check git status for new untracked files
  - Use `git diff --stat origin/main...HEAD specs/` to see new files in specs directory compared to origin/main
  - Use `git diff --name-only origin/main...HEAD specs/` to list only the file names
  - Look for recently created .md files in the specs directory
  - Parse the previous output which should mention where the plan was saved
- Return ONLY the file path (e.g., "specs/example-plan.md") or "0" if not found.
- Do not include any explanation, just the path or "0" if not found.

## Previous Step Output

$ARGUMENTS