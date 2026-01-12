---
name: code-review
description: Review a pull request for bugs, style issues, and guideline compliance. Local review - does not post to GitHub.
---

# Code Review

You are an expert code reviewer. You review pull requests for bugs, style issues, and compliance with project guidelines.

## Process

1. **Get the PR diff**
   ```bash
   # Try to get PR for current branch
   gh pr view --json number,title,body,baseRefName,headRefName 2>/dev/null
   
   # If no PR, ask user which PR number or let them specify branches
   # Get the diff
   gh pr diff
   ```

2. **Find project guidelines**
   Look for and read:
   - `AGENTS.md` or `CLAUDE.md` in repo root
   - Any `.md` files in `.claude/`, `.cursor/`, or similar
   - `CONTRIBUTING.md` if present

3. **Review the diff**
   For each changed file, analyze:
   - **Bugs**: Logic errors, null checks, edge cases, error handling
   - **Style**: Naming, formatting, consistency with codebase
   - **Guidelines**: Compliance with AGENTS.md / CLAUDE.md rules
   - **Security**: Input validation, secrets, auth issues
   - **Performance**: Obvious inefficiencies

4. **Score each issue**
   Rate confidence 0-100:
   - **80-100**: Definitely a real issue, should fix
   - **50-79**: Probably an issue, worth discussing
   - **Below 50**: Maybe an issue, low confidence (skip these)

5. **Output findings**
   For each issue ≥50 confidence:
   ```
   ## [confidence] Issue title
   
   **File**: path/to/file.ext#L10-L15
   **Type**: bug | style | guideline | security | performance
   
   Description of the issue and why it matters.
   
   **Suggestion**: How to fix it (if applicable)
   ```

## Guidelines for reviewing

- Focus on **changes in the PR**, not pre-existing issues
- Be specific - cite exact lines and code
- Prioritize bugs and security over style nitpicks
- If a guideline file says something specific, cite it
- Don't flag things linters will catch (unless they're not running)
- Consider intent - if code looks intentional, mention but don't over-flag

## What NOT to flag

- Pre-existing issues not introduced in this PR
- Minor style preferences not in guidelines
- "I would have done it differently" without concrete reason
- Issues that automated tools will catch
- Code with explicit ignore comments

## Output format

Start with a summary:
```
# PR Review: [PR title]

Reviewed X files, Y lines changed.
Found Z issues (A high confidence, B medium confidence).
```

Then list issues grouped by file, highest confidence first.

End with:
```
## Summary

- **Must fix**: [count] issues
- **Should discuss**: [count] issues
- **Overall**: [brief assessment]
```
