# Skills

Skills are instruction files that the agent loads on-demand for specific tasks.

## Skill Locations

Skills are discovered from these locations (later overrides earlier on name collision):

1. `~/.claude/skills/*/SKILL.md` (Claude Code user skills)
2. `<cwd>/.claude/skills/*/SKILL.md` (Claude Code project skills)
3. `~/.pi/agent/skills/*.md` (Pi user skills)
4. `<cwd>/.pi/skills/*.md` (Pi project skills)

Skill names and descriptions are listed in the system prompt. When a task matches a skill's description, the agent uses the `read` tool to load it.

## Creating Skills

A skill is a markdown file with YAML frontmatter containing a `description` field:

```markdown
---
description: Extract text and tables from PDF files
---

# PDF Processing Instructions

1. Use `pdftotext` to extract plain text
2. For tables, use `tabula-py` or similar
3. Always verify extraction quality

Scripts are in: {baseDir}/scripts/
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | Short description for skill selection |
| `name` | No | Override skill name (defaults to filename or directory name) |

The parser only supports single-line `key: value` syntax. Multiline YAML blocks are not supported.

### Variables

`{baseDir}` is replaced with the directory containing the skill file. Use it to reference bundled scripts or resources.

### Subdirectories (Pi Skills)

Pi skills in subdirectories use colon-separated names:
- `~/.pi/agent/skills/db/migrate.md` → `db:migrate`
- `<cwd>/.pi/skills/aws/s3/upload.md` → `aws:s3:upload`

## Claude Code Compatibility

Pi reads Claude Code skills from `~/.claude/skills/*/SKILL.md`. The `allowed-tools` and `model` frontmatter fields are ignored since Pi cannot enforce them.

## Disabling Skills

CLI flag:
```bash
pi --no-skills
```

Or in `~/.pi/agent/settings.json`:
```json
{
  "skills": {
    "enabled": false
  }
}
```

## Example

```markdown
---
description: Perform code review with security and performance analysis
---

# Code Review

Analyze:

## Security
- Input validation
- SQL injection
- XSS vulnerabilities

## Performance
- Algorithm complexity
- Memory usage
- Query efficiency
```
