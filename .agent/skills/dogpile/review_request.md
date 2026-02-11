# Dogpile Modularization Code Review Request

## Summary
The dogpile skill has been refactored from a 2065-line monolith into 16 separate debuggable modules.

## Files to Review

### Core Configuration
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/config.py` (103 lines) - Constants, paths, semaphores, optional deps

### Utilities
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/utils.py` (221 lines) - Common utilities, rate limiting, run_command

### Provider Modules
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/brave.py` (141 lines) - Brave Search integration
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/perplexity.py` (48 lines) - Perplexity AI integration
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/arxiv_search.py` (199 lines) - ArXiv paper search
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/github_search.py` (325 lines) - GitHub core search functions
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/github_deep.py` (345 lines) - GitHub deep search/Stage 2 orchestration
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/youtube_search.py` (144 lines) - YouTube video/transcript search
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/wayback.py` (68 lines) - Wayback Machine snapshot check
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/codex.py` (260 lines) - OpenAI Codex reasoning
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/discord.py` (55 lines) - Discord message search
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/readarr.py` (56 lines) - Readarr/Usenet search

### Report Generation
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/formatters.py` (102 lines) - Simple section formatters
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/synthesis.py` (320 lines) - Report synthesis/generation

### CLI Entry Point
- `/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile/cli.py` (377 lines) - Thin CLI with search, resources, presets commands

## Review Focus Areas
1. Import structure and circular dependency risks
2. Error handling consistency across modules
3. Rate limiting and resilience patterns (tenacity, semaphores)
4. Type annotations completeness
5. Docstring quality and consistency
6. Code duplication that could be extracted

## Quality Gates Verified
- All modules < 500 lines: PASS
- No circular imports: PASS
- sanity.sh passes: PASS
- All imports work correctly: PASS
