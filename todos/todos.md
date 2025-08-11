- agent/tui: interrupting requests to model  via ESC doesn't work. Interrupting bash tool works.

- agent/tui: "read all README.md files except in node_modules", gpt-5. wait for completion, then send a new message. Getting garbled output. this happens for both of the renderDifferential and renderDifferentialSurgical methods. We need to emiulate this in a test and get to the bottom of it.
    ```markdown
    >> pi interactive chat <<<
    Press Escape to interrupt while processing
    Press CTRL+C to clear the text editorM deployments and building AI agents.peScript API)
    Press CTRL+C twice quickly to exitdeterministic programs (via JSON mode in any language or the
    ## PackagesAPI)
    [user]iding your own system prompts and tools
    read all README.md files except in node_modulesrminal UI library with differential rendering
    - **[@mariozechner/pi-agent](packages/agent)** - General-purpose agent with tool calling and session
    [assistant]re lines)
    [tool] glob({"pattern":"**/README.md"}) - CLI for managing vLLM deployments on GPU pods
    README.mdad({"path": "packages/pods/README.md"})
    node_modules/@biomejs/biome/README.md
    node_modules/@esbuild/darwin-arm64/README.md
    node_modules/@types/node/README.mdnt/README.md"}) vLLM configuration for agentic workloads.
    node_modules/@xterm/headless/README.md
    node_modules/@xterm/xterm/README.md
    node_modules/chalk/readme.md tool calling and session persistence, modeled after Claude Code but
    node_modules/esbuild/README.md. It comes with a built-in TUI (also modeled after Claude Code) for
    node_modules/fsevents/README.md
    node_modules/get-tsconfig/README.md
    ... (59 more lines)ned to be easy:
    - Writing custom UIs on top of it (via JSON mode in any language or the TypeScript API)
    [tool] read({"path": "README.md"})deterministic programs (via JSON mode in any language or the
    # Pi MonorepoI)ath": "packages/tui/README.md"})
    - Providing your own system prompts and tools
    A collection of tools for managing LLM deployments and building AI agents.
    Terminal UI framework with surgical differential rendering for building flicker-free interactive CLI
    ## Packagesre lines)

    - **[@mariozechner/pi-tui](packages/tui)** - Terminal UI library with differential rendering
    - **[@mariozechner/pi-agent](packages/agent)** - General-purpose agent with tool calling and session
    persistencel Differential Rendering**: Three-strategy system that minimizes redraws to 1-2 lines for
    - **[@mariozechner/pi](packages/pods)** - CLI for managing vLLM deployments on GPU podsads.
    - **Scrollback Buffer Preservation**: Correctly maintains terminal history when content exceeds
    ... (76 more lines)
    - **Zero Flicker**: Components like text editors remain perfectly still while other parts update
    [tool] read({"path": "packages/agent/README.md"})tocomplete, selection lists, markdown rendering
    # pi-agentl -g @mariozechner/pi
    ```
    A general-purpose agent with tool calling and session persistence, modeled after Claude Code but
    extremely hackable and minimal. It comes with a built-in TUI (also modeled after Claude Code) for────╮
    interactive use.                                                                                     │
    [tool] read({"path": "packages/tui/README.md"})──────────────────────────────────────────────────────╯
    Everything is designed to be easy:
    - Writing custom UIs on top of it (via JSON mode in any language or the TypeScript API)
    - Using it for inference steps in deterministic programs (via JSON mode in any language or theve CLI
    TypeScript API)
    - Providing your own system prompts and tools
    - Working with various LLM providers or self-hosted LLMs

    ... (422 more lines)ntial Rendering**: Three-strategy system that minimizes redraws to 1-2 lines for
    typical updates
    [tool] read({"path": "packages/pods/README.md"})maintains terminal history when content exceeds
    # piport
    - **Zero Flicker**: Components like text editors remain perfectly still while other parts update
    Deploy and manage LLMs on GPU pods with automatic vLLM configuration for agentic workloads.ering
    ... (570 more lines)
    ## Installation
    [user]
    ```bash
    npm install -g @mariozechner/pi
    ```sistant]
    ⠴ Thinking...
    ... (501 more lines)

    [tool] read({"path": "packages/tui/README.md"})──────────────────────────────────────────────────────╮
    # @mariozechner/pi-tui                                                                               │
    ╰────────────────────────────────────────────────────────────────────────────────────────────────────╯
    Terminal UI framework with surgical differential rendering for building flicker-free interactive CLI
    applications.

    ## Features

    - **Surgical Differential Rendering**: Three-strategy system that minimizes redraws to 1-2 lines for
    typical updates
    - **Scrollback Buffer Preservation**: Correctly maintains terminal history when content exceeds
    viewport
    - **Zero Flicker**: Components like text editors remain perfectly still while other parts update
    - **Interactive Components**: Text editor with autocomplete, selection lists, markdown rendering
    ... (570 more lines)

    [user]
    l

    [assistant]
    Do you want me to list the current directory contents? If yes, should I include hidden files and subdir
    ectories?


    ╭────────────────────────────────────────────────────────────────────────────────────────────────────╮
    │ >                                                                                                  │
    ╰────────────────────────────────────────────────────────────────────────────────────────────────────╯
    ↑14,783 ↓160 ⚡128 ⚒ 5
    ```

- pods: pi start outputs all models that can be run on the pod. however, it doesn't check the vllm version. e.g. gpt-oss can only run via vllm+gpt-oss. glm4.5 can only run on vllm nightly.

- agent: improve reasoning section in README.md

- agent: ultrathink to temporarily set reasoning_effort?

- agent: ripgrep tool is very broken
    [tool] rg({"args":"-l --hidden --glob \"**/README.md\""})
    ripgrep error: rg: ripgrep requires at least one pattern to execute a search

- agent: gpt-5/responses api seems to be broken?
    - prompt: read all README.md files
    - output:
        [error] 400 Item 'fc_68990b4ddf60819e9138b7a496da3fcb04d5f47f123043f7' of type 'function_call' was provided without its required 'reasoning' item: 'rs_68990b4d5784819eac65086d9a6e42e704d5f47f123043f7'.

- agent: need to figure out a models max context lenght
    - Add automatic context length detection via models endpoint
    - Cache per baseURL/model combination in $PI_CONFIG_DIR/models.json or ~/.pi/models.json
    - Should be part of preflight check in agent (like reasoning support detection)
    - Provider support status:
        - vLLM: ✅ `/v1/models` → `max_model_len`
        - Groq: ✅ `/openai/v1/models` → `context_window`
        - OpenRouter: ✅ `/api/v1/models` → `context_length`
        - Gemini: ✅ `/v1beta/models` (native API) → `inputTokenLimit`
        - Anthropic: ❌ `/v1/models` (no context info)
        - OpenAI: ❌ `/v1/models` (no context info)
    - For Anthropic/OpenAI, may need hardcoded fallback values or separate lookup table

- agent: compaction & micro compactionexi

- agent: token usage output sucks, make it better
    - current: ↑1,706 ↓409 ⚒ 2
    - maybe: ↑ 1,706 - ↓ 409 - ⚒ 2 (or dot?)
    - add context window usage percentage (e.g., "23% context used")
    - requires context length detection from models endpoint (see todo above)

- agent: test for basic functionality, including thinking, completions & responses API support for all the known providers and their endpoints.

- agent: groq responses api throws on second message
    ```
    ➜  pi-mono git:(main) ✗ npx tsx packages/agent/src/cli.ts --base-url https://api.groq.com/openai/v1 --api-key $GROQ_API_KEY --model openai/gpt-oss-120b --api responses
    >> pi interactive chat <<<
    Press Escape to interrupt while processing
    Press CTRL+C to clear the text editor
    Press CTRL+C twice quickly to exit

    [user]
    think step by step: what's 2+2?

    [assistant]
    [thinking]
    The user asks "think step by step: what's 2+2?" They want a step-by-step reasoning. That's
    trivial: 2+2=4. Provide answer with steps.

    Sure! Let’s break it down:

    1. Identify the numbers: We have the numbers 2 and 2.
    2. Add the first number to the second:
    3. Calculate:

    2 + 2 = 4

    Answer: 2 + 2 = 4.

    [user]
    what was your last thinking content?

    [assistant]
    [error] 400 `input`: `items[3]`: `role`: assistant role cannot be used with type='message'
    (use EasyInputMessage format without type field)
    ```

- pods: if a pod is down and i run `pi list`, verifying processes says All processes verified. But that can't be true, as we can no longer SSH into the pod to check.

- agent: start a new agent session. when i press CTRL+C, "Press Ctrl+C again to exit" appears above the text editor followed by an empty line. After about 1 second, the empty line disappears. We should either not show the empty line, or always show the empty line. Maybe Ctrl+C info should be displayed below the text editor.

- agent: we need to make system prompt and tools pluggable. We need to figure out the simplest way for users to define system prompts and toolkits. A toolkit could be a subset of the built-in tools, a mixture of a subset of the built-in tools plus custom self-made tools, maybe include MCP servers, and so on. We need to figure out a way to make this super easy. users should be able to write their tools in whatever language they fancy. which means that probably something like process spawning plus studio communication transport would make the most sense. but then we were back at MCP basically. And that does not support interruptibility, which we need for the agent. So if the agent invokes the tool and the user presses escape in the interface, then the tool invocation must be interrupted and whatever it's doing must stop, including killing all sub-processes. For MCP this could be solved for studio MCP servers by, since we spawn those on startup or whenever we load the tools, we spawn a process for an MCP server and then reuse that process for subsequent tool invocations. If the user interrupts then we could just kill that process, assuming that anything it's doing or any of its sub-processes will be killed along the way. So I guess tools could all be written as MCP servers, but that's a lot of overhead. It would also be nice to be able to provide tools just as a bash script that gets some inputs and return some outputs based on the inputs Same for Go apps or TypeScript apps invoked by MPX TSX. just make the barrier of entry for writing your own tools super fucking low. not necessarily going full MCP. but we also need to support MCP. So whatever we arrive at, we then need to take our built-in tools and see if those can be refactored to work with our new tools