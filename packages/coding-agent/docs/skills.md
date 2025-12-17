# Skills

Skills are self-contained capability packages that the agent loads on-demand. A skill provides specialized workflows, setup instructions, helper scripts, and reference documentation for specific tasks.

**Example use cases:**
- Web search and content extraction (Brave Search API)
- Browser automation via Chrome DevTools Protocol
- Google Calendar, Gmail, Drive integration
- PDF/DOCX processing and creation
- Speech-to-text transcription
- YouTube transcript extraction

See [Skill Repositories](#skill-repositories) for ready-to-use skills.

## When to Use Skills

| Need | Solution |
|------|----------|
| Always-needed context (conventions, commands) | AGENTS.md |
| User triggers a specific prompt template | Slash command |
| Additional tool directly callable by the LLM (like read/write/edit/bash) | Custom tool |
| On-demand capability package (workflows, scripts, setup) | Skill |

Skills are loaded when:
- The agent decides the task matches a skill's description
- The user explicitly asks to use a skill (e.g., "use the pdf skill to extract tables")

**Good skill examples:**
- Browser automation with helper scripts and CDP workflow
- Google Calendar CLI with setup instructions and usage patterns
- PDF processing with multiple tools and extraction patterns
- Speech-to-text transcription with API setup

**Not a good fit for skills:**
- "Always use TypeScript strict mode" → put in AGENTS.md
- "Review my code" → make a slash command
- Need user confirmation dialogs or custom TUI rendering → make a custom tool

## Skill Structure

A skill is a directory with a `SKILL.md` file. Everything else is freeform. Example structure:

```
my-skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Helper scripts (bash, python, node)
│   └── process.sh
├── references/           # Detailed docs loaded on-demand
│   └── api-reference.md
└── assets/               # Templates, images, etc.
    └── template.json
```

### SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific.
---

# My Skill

## Setup

Run once before first use:
\`\`\`bash
cd {baseDir}
npm install
\`\`\`

## Usage

\`\`\`bash
{baseDir}/scripts/process.sh <input>
\`\`\`

## Workflow

1. First step
2. Second step
3. Third step
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | What the skill does and when to use it |
| `name` | No | Override skill name (defaults to directory name) |

The `description` is critical. It's shown in the system prompt and determines when the agent loads the skill. Be specific about both what it does and when to use it.

### The `{baseDir}` Placeholder

Use `{baseDir}` to reference files in the skill's directory. The agent sees each skill's base directory and substitutes it when following instructions:

```markdown
Helper scripts: {baseDir}/scripts/
Config template: {baseDir}/assets/config.json
```

## Skill Locations

Skills are discovered from these locations (later wins on name collision):

1. `~/.codex/skills/**/SKILL.md` (Codex CLI, recursive)
2. `~/.claude/skills/*/SKILL.md` (Claude Code user, one level)
3. `<cwd>/.claude/skills/*/SKILL.md` (Claude Code project, one level)
4. `~/.pi/agent/skills/**/SKILL.md` (Pi user, recursive)
5. `<cwd>/.pi/skills/**/SKILL.md` (Pi project, recursive)

### Subdirectory Naming

Pi skills in subdirectories use colon-separated names:
- `~/.pi/agent/skills/db/migrate/SKILL.md` → `db:migrate`
- `<cwd>/.pi/skills/aws/s3/upload/SKILL.md` → `aws:s3:upload`

## How Skills Work

1. At startup, pi scans skill locations and extracts names + descriptions
2. The system prompt includes a list of available skills with their descriptions
3. When a task matches, the agent uses `read` to load the full SKILL.md
4. The agent follows the instructions, using `{baseDir}` to reference scripts/assets

This is progressive disclosure: only descriptions are always in context, full instructions load on-demand.

## Example: Web Search Skill

```
brave-search/
├── SKILL.md
├── search.js
└── content.js
```

**SKILL.md:**
```markdown
---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content.
---

# Brave Search

## Setup

\`\`\`bash
cd {baseDir}
npm install
\`\`\`

## Search

\`\`\`bash
{baseDir}/search.js "query"              # Basic search
{baseDir}/search.js "query" --content    # Include page content
\`\`\`

## Extract Page Content

\`\`\`bash
{baseDir}/content.js https://example.com
\`\`\`
```

## Compatibility

**Claude Code**: Pi reads skills from `~/.claude/skills/*/SKILL.md`. The `allowed-tools` and `model` frontmatter fields are ignored.

**Codex CLI**: Pi reads skills from `~/.codex/skills/` recursively. Hidden files/directories and symlinks are skipped.

## Skill Repositories

For inspiration and ready-to-use skills:

- [Anthropic Skills](https://github.com/anthropics/skills) - Official skills for document processing (docx, pdf, pptx, xlsx), web development, and more
- [Pi Skills](https://github.com/badlogic/pi-skills) - Skills for web search, browser automation, Google APIs, transcription

## Disabling Skills

CLI:
```bash
pi --no-skills
```

Settings (`~/.pi/agent/settings.json`):
```json
{
  "skills": {
    "enabled": false
  }
}
```
