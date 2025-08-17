# Create AI Package with Unified API

**Status:** Done
**Agent PID:** 10965

## Original Todo
ai: create a new package ai (package name @mariozechner/ai) which implements a common api for the openai, anthropic, and google gemini apis
    - look at the other packages and how they are set up, mirror that setup for ai
    - install the latest version of each dependency via npm in the ai package
        - openai@5.12.2
        - @anthropic-ai/sdk@0.60.0
        - @google/genai@1.14.0
    - investigate the APIs in their respective node_modules folder so you understand how to use them. specifically, we need to understand how to:
        - stream responses, including reasoning/thinking tokens and tool calls
        - abort requests
        - handle errors
        - handle stop reasons
        - maintain the context (message history) such that it can be serialized in a uniform format to disk, and deserialized again later and used with the other api
        - count tokens (input, output, cached read, cached write)
        - enable caching
    - Create a plan.md in the ai package that details how the unified API on top of all three could look like. we want the most minimal api possible, which allows serialization/deserialization, turning on/off reasoning/thinking, and handle system prompt and tool specifications

## Description
Create the initial package scaffold for @mariozechner/ai following the established monorepo patterns, install the required dependencies (openai, anthropic, google genai SDKs), and create a plan.md file that details the unified API design for all three providers.

*Read [analysis.md](./analysis.md) in full for detailed codebase research and context*

## Implementation Plan
- [x] Create package directory structure at packages/ai/
- [x] Create package.json with proper configuration following monorepo patterns
- [x] Create tsconfig.build.json for build configuration
- [x] Create initial src/index.ts file
- [x] Add package to root tsconfig.json path mappings
- [x] Update root package.json build script to include ai package
- [x] Install dependencies: openai@5.12.2, @anthropic-ai/sdk@0.60.0, @google/genai@1.14.0
- [x] Create README.md with package description
- [x] Create plan.md detailing the unified API design
- [x] Investigate OpenAI, Anthropic, and Gemini APIs in detail
- [x] Document implementation details for each API
- [x] Update todos/project-description.md with "How to Create a New Package" section
- [x] Update todos/project-description.md Testing section to reflect that tui has Node.js built-in tests
- [x] Run npm install from root to link everything
- [x] Verify package builds correctly with npm run build

## Notes
[Implementation notes]