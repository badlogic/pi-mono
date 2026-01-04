/**
 * Prompt for the /init command that generates AGENTS.md files.
 */

export const INIT_PROMPT = `Analyze this codebase and create an AGENTS.md file in the project root.

Explore the project structure, configuration files, and source code to understand:
- What the project does and its purpose
- Directory structure and architecture
- Build system and common commands (check package.json, Makefile, Cargo.toml, etc.)
- Code style conventions (look at existing code, linter configs, editorconfig, etc.)
- Testing setup and how to run tests
- Any other relevant patterns or guidelines

Then write a comprehensive AGENTS.md file that will help AI coding agents work effectively on this project. Be specific and concrete based on what you find - don't use placeholder text.`;
