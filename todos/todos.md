- ai: test abort signal

- ai: implement and test session hand-off
    - thinkingSignatures are incompatible between models/providers
    - when converting Message instance, LLM impl needs to check model
        - if same provider/model as LLM impl config, convert as is
        - if provider and/or model != LLM impl config, convert thinking to plain user text Message with "Thinking: " prepended

- tui: use stripVTControlCharacters in components to strip ANSI sequences and better estimate line widths? specifically markdown and text component?

- tui: if text editor gets bigger than viewport, we get artifacts in scrollbuffer

- tui: need to benachmark our renderer. always compares old lines vs new lines and does a diff. might be a bit much for 100k+ lines.

- pods: pi start outputs all models that can be run on the pod. however, it doesn't check the vllm version. e.g. gpt-oss can only run via vllm+gpt-oss. glm4.5 can only run on vllm nightly.

- agent: we need to make system prompt and tools pluggable. We need to figure out the simplest way for users to define system prompts and toolkits. A toolkit could be a subset of the built-in tools, a mixture of a subset of the built-in tools plus custom self-made tools, maybe include MCP servers, and so on. We need to figure out a way to make this super easy. users should be able to write their tools in whatever language they fancy. which means that probably something like process spawning plus studio communication transport would make the most sense. but then we were back at MCP basically. And that does not support interruptibility, which we need for the agent. So if the agent invokes the tool and the user presses escape in the interface, then the tool invocation must be interrupted and whatever it's doing must stop, including killing all sub-processes. For MCP this could be solved for studio MCP servers by, since we spawn those on startup or whenever we load the tools, we spawn a process for an MCP server and then reuse that process for subsequent tool invocations. If the user interrupts then we could just kill that process, assuming that anything it's doing or any of its sub-processes will be killed along the way. So I guess tools could all be written as MCP servers, but that's a lot of overhead. It would also be nice to be able to provide tools just as a bash script that gets some inputs and return some outputs based on the inputs Same for Go apps or TypeScript apps invoked by MPX TSX. just make the barrier of entry for writing your own tools super fucking low. not necessarily going full MCP. but we also need to support MCP. So whatever we arrive at, we then need to take our built-in tools and see if those can be refactored to work with our new tools

- agent: we need to make it possibly for tools to specify how their results should be rendered. Since we can have any kind of renderer, we need to come up with a general system that says "this field in the output needs to be a markdown component" or "this field in the output needs to be a diff", etc. we also need to think about how to display the inputs to tools.

- agent: the agent or user should be able to reload a tool, for tools that the agent keeps alive, like MCP servers.