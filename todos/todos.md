- agent: improve reasoning section in README.md

- agent: ultrathink to temporarily set reasoning_effort?

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

- agent: test for basic functionality, including thinking, completions & responses API support for all the known providers and their endpoints.

- agent: token usage gets overwritten with each message that has usage data. however, if the latest data doesn't have a specific usage field, we record undefined i think? also,   {"type":"token_usage" "inputTokens":240,"outputTokens":35,"totalTokens":275,"cacheReadTokens":0,"cacheWriteTokens":0} doesn't contain reasoningToken? do we lack initialization? See case "token_usage": in renderers. probably need to check if lastXXX > current and use lastXXX.

-agent: groq responses api throws on second message
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

- tui: npx tsx test/demo.ts, using /exit or pressing CTRL+C does not work to exit the demo.

- agent: we need to make system prompt and tools pluggable. We need to figure out the simplest way for users to define system prompts and toolkits. A toolkit could be a subset of the built-in tools, a mixture of a subset of the built-in tools plus custom self-made tools, maybe include MCP servers, and so on. We need to figure out a way to make this super easy. users should be able to write their tools in whatever language they fancy. which means that probably something like process spawning plus studio communication transport would make the most sense. but then we were back at MCP basically. And that does not support interruptibility, which we need for the agent. So if the agent invokes the tool and the user presses escape in the interface, then the tool invocation must be interrupted and whatever it's doing must stop, including killing all sub-processes. For MCP this could be solved for studio MCP servers by, since we spawn those on startup or whenever we load the tools, we spawn a process for an MCP server and then reuse that process for subsequent tool invocations. If the user interrupts then we could just kill that process, assuming that anything it's doing or any of its sub-processes will be killed along the way. So I guess tools could all be written as MCP servers, but that's a lot of overhead. It would also be nice to be able to provide tools just as a bash script that gets some inputs and return some outputs based on the inputs Same for Go apps or TypeScript apps invoked by MPX TSX. just make the barrier of entry for writing your own tools super fucking low. not necessarily going full MCP. but we also need to support MCP. So whatever we arrive at, we then need to take our built-in tools and see if those can be refactored to work with our new tools