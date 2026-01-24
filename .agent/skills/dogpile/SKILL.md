name: dogpile
description: >
Deep research aggregator that searches Brave (Web), Perplexity (AI), GitHub (Code/Issues),
ArXiv (Papers), YouTube (Videos), and Wayback Machine simultaneously.
Provides a consolidated Markdown report with an ambiguity check and Agentic Handoff.
allowed-tools: ["run_command", "read_file"]
triggers:

- dogpile
- research
- deep search
- find code
- search everything
  metadata:
  short-description: Deep research aggregator (Web, AI, Code, Papers, Videos)

---

# Dogpile: Deep Research Aggregator

Orchestrate a multi-source deep search to "dogpile" on a problem from every angle.

## Analyzed Sources

1.  **Brave Search**: Broad web context, news, and official docs.
2.  **Perplexity**: AI-synthesized deep answers and reasoning.
3.  **GitHub**:
    - **Repositories**: Finding relevant libraries and tools.
    - **Deep Code Search**: Searching _inside_ the most relevant repo for definitions.
    - **Issues**: Finding discussions, bugs, and workarounds.
4.  **ArXiv**: Academic papers and latest research.
5.  **YouTube**: Video tutorials, talks, and transcripts.
6.  **Wayback Machine**: Historical snapshots for URLs.

## Features

1.  **Aggregated Search**: Brave (Web), Perplexity (AI), GitHub (Code), ArXiv (Papers), YouTube.
2.  **Two-Stage Code Search**: Identifies target repo and searches deeper for code/issues.
3.  **Wayback Machine**: Checks for snapshots if query is a URL.
4.  **Agentic Extraction**: detailed abstracts/descriptions provided for Agent decision.
5.  **Progress Logging**: Real-time status logged to `dogpile.log` for monitoring.

## New Commands

- `./run.sh search "query"`: Run a search.
- `./run.sh monitor`: Open the Real-time TUI Monitor.

## Usage

```bash
# Search for everything on a topic
./run.sh search "AI agent memory systems"
```

## Agentic Handoff

The skill automatically analyzes queries for ambiguity.

- If the query is clear (e.g., "python sort list"), it proceeds.
- If ambiguous (e.g., "apple"), it returns a JSON object with clarifying questions.
  - The calling agent should interpret this JSON and ask the user the questions.
