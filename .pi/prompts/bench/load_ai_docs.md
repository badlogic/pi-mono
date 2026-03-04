---
description: Fetch and save AI documentation using model-specific subagents for benchmarking
argument-hint: [run-name]
allowed-tools: Task, Write, Read, Bash
---

# Load AI Docs Benchmark

Fetch documentation from URLs and save to local markdown files using model-specific subagents. This benchmark tests documentation retrieval, file I/O, and question-answering capabilities.

## Variables

RUN_NAME: $1
AI_DOCS_README: `ai_docs/README.md`
OUTPUT_DIRECTORY: `ai_docs/<RUN_NAME>/`
AGENT_NAME: `fetch-docs-<RUN_NAME>`

USER_QUESTIONS:
1. **Subagents**: "What are the three different priority levels for subagents (project-level, user-level, CLI-defined), and how does the priority system determine which subagent is used when there are naming conflicts? Explain with a specific example scenario."

2. **Plugins**: "Explain the complete directory structure required for a plugin that includes commands, agents, skills, hooks, and MCP servers. What is the purpose of the .claude-plugin directory and what files must it contain?"

3. **Skills**: "How do Agent Skills differ from subagents in terms of invocation, context management, and when each should be used? Provide specific use cases where Skills are preferred over subagents and vice versa."

## Instructions

- Read the `AI_DOCS_README` file to get the list of documentation URLs
- For each URL in the README:
  1. Create the output directory `OUTPUT_DIRECTORY` if it doesn't exist
  2. Use the Task tool to invoke the `AGENT_NAME` subagent
  3. Pass a prompt to the subagent with the URL and output file path
  4. The subagent will fetch and save the documentation
- After all documentation is fetched, answer each question in `USER_QUESTIONS`
- Save all answers to `OUTPUT_DIRECTORY/answers.md`
- IMPORTANT: Be sure to use the `AGENT_NAME` subagent specified by RUN_NAME
- IMPORTANT: The subagent should handle all fetching and saving. Do not fetch or save files yourself.

## Workflow

1. Read `AI_DOCS_README` to get URLs
2. Create `OUTPUT_DIRECTORY`
3. For each URL in the README:
   - Extract the URL and determine output filename from the URL description
   - Use Task tool to invoke `@<AGENT_NAME>` with prompt: "Fetch <URL> and save to <OUTPUT_DIRECTORY>/<filename>.md"
   - Track success/failure for each URL
4. After all docs are fetched, read the saved documentation files
5. Answer each question in `USER_QUESTIONS` based on the documentation
6. Save answers to `OUTPUT_DIRECTORY/answers.md` in the Report Format

## Report Format

Save to `OUTPUT_DIRECTORY/answers.md`:

```markdown
# AI Documentation Q&A - <RUN_NAME>

## Fetch Results
- ✅ Success: <url> → <file-path>
- ✅ Success: <url> → <file-path>
- ❌ Failure: <url> → <error>

## Question 1: Subagents Priority System
<Your detailed answer here>

## Question 2: Plugin Directory Structure
<Your detailed answer here>

## Question 3: Skills vs Subagents
<Your detailed answer here>
```
