# Skills

Skills are self-contained capability packages that the agent loads on-demand. A skill provides specialized workflows, setup instructions, helper scripts, and reference documentation for specific tasks.

Pi implements the [Agent Skills standard](https://agentskills.io/specification).

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
cd /path/to/skill && npm install
\`\`\`

## Usage

\`\`\`bash
./scripts/process.sh <input>
\`\`\`

## Workflow

1. First step
2. Second step
3. Third step
```

### Frontmatter Fields

Per the [Agent Skills specification](https://agentskills.io/specification#frontmatter-required):

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | Max 64 chars. Lowercase a-z, 0-9, hyphens only. Must match parent directory name. |
| `description` | Yes | Max 1024 chars. What the skill does and when to use it. |
| `license` | No | License name or reference to bundled license file. |
| `compatibility` | No | Max 500 chars. Environment requirements (system packages, network access, etc.). |
| `metadata` | No | Arbitrary key-value mapping for additional metadata. |
| `allowed-tools` | No | Space-delimited list of pre-approved tools (experimental). |

#### Name Validation

The `name` field must:
- Be 1-64 characters
- Contain only lowercase letters (a-z), numbers (0-9), and hyphens
- Not start or end with a hyphen
- Not contain consecutive hyphens (--)
- Match the parent directory name exactly

Valid: `pdf-processing`, `data-analysis`, `code-review`
Invalid: `PDF-Processing`, `-pdf`, `pdf--processing`

#### Description Best Practices

The `description` is critical. It determines when the agent loads the skill. Be specific about both what it does and when to use it.

Good:
```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.
```

Poor:
```yaml
description: Helps with PDFs.
```

### File References

Use relative paths from the skill directory:

```markdown
See [the reference guide](references/REFERENCE.md) for details.

Run the extraction script:
\`\`\`bash
./scripts/extract.py input.pdf
\`\`\`
```

## Skill Locations

Skills are discovered from these locations (later wins on name collision):

1. `~/.codex/skills/**/SKILL.md` (Codex CLI, recursive)
2. `~/.claude/skills/*/SKILL.md` (Claude Code user, one level)
3. `<cwd>/.claude/skills/*/SKILL.md` (Claude Code project, one level)
4. `~/.pi/agent/skills/**/SKILL.md` (Pi user, recursive)
5. `<cwd>/.pi/skills/**/SKILL.md` (Pi project, recursive)

## How Skills Work

1. At startup, pi scans skill locations and extracts names + descriptions
2. The system prompt includes available skills in XML format
3. When a task matches, the agent uses `read` to load the full SKILL.md
4. The agent follows the instructions, using relative paths to reference scripts/assets

This is progressive disclosure: only descriptions are always in context, full instructions load on-demand.

## Validation Warnings

Pi validates skills against the Agent Skills standard and warns (but still loads) non-compliant skills:

- Name doesn't match parent directory
- Name exceeds 64 characters
- Name contains invalid characters
- Name starts/ends with hyphen or has consecutive hyphens
- Description missing or exceeds 1024 characters
- Unknown frontmatter fields

Name collisions (same name from different locations) warn and keep the first skill found.

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
cd /path/to/brave-search && npm install
\`\`\`

## Search

\`\`\`bash
./search.js "query"              # Basic search
./search.js "query" --content    # Include page content
\`\`\`

## Extract Page Content

\`\`\`bash
./content.js https://example.com
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
