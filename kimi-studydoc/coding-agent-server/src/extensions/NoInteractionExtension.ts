import type { ExtensionAPI, ExtensionContext, ToolCallContext } from "@mariozechner/pi-coding-agent";

/**
 * NoInteractionExtension
 * 
 * This extension ensures that during execution phase:
 * 1. No user interaction tools can be called
 * 2. No clarification requests are allowed
 * 3. Any attempt to interact with user throws an error
 * 
 * This is a safety mechanism to guarantee deterministic execution
 * of long-running tasks without human intervention.
 */

const FORBIDDEN_TOOLS = [
  "ask_user",
  "question",
  "clarify",
  "confirm",
  "prompt",
  "input",
  "select",
  "questionnaire",
];

const FORBIDDEN_PATTERNS = [
  /ask.*user/i,
  /need.*clarification/i,
  /please.*confirm/i,
  /waiting.*input/i,
];

export default function NoInteractionExtension(pi: ExtensionAPI): void {
  // Track if we're in execution mode
  let executionMode = false;

  pi.registerCommand("enable-no-interaction", {
    description: "Enable no-interaction mode (for execution phase)",
    async run(ctx: ExtensionContext) {
      executionMode = true;
      ctx.ui.notify("🔒 No-interaction mode enabled - user input is blocked");
    },
  });

  pi.registerCommand("disable-no-interaction", {
    description: "Disable no-interaction mode",
    async run(ctx: ExtensionContext) {
      executionMode = false;
      ctx.ui.notify("🔓 No-interaction mode disabled");
    },
  });

  // Hook into tool calls to block interactive tools
  pi.onToolCall((toolCall: { name: string; arguments?: Record<string, unknown> }, ctx: ToolCallContext) => {
    if (!executionMode) {
      return; // Allow in non-execution mode
    }

    const toolName = toolCall.name.toLowerCase();

    // Check if tool is in forbidden list
    if (FORBIDDEN_TOOLS.includes(toolName)) {
      const error = new Error(
        `INTERACTION_BLOCKED: Tool '${toolCall.name}' is not allowed in execution mode. ` +
        `The agent attempted to request user interaction during a non-interactive execution phase. ` +
        `This indicates either:\n` +
        `1. The skill requires information that should have been provided during preflight\n` +
        `2. The agent encountered an unexpected situation\n` +
        `3. The skill is not designed for autonomous execution`
      );
      
      // Log the violation
      console.error(`[NoInteractionExtension] Blocked tool call: ${toolCall.name}`, {
        arguments: toolCall.arguments,
        timestamp: new Date().toISOString(),
      });

      throw error;
    }

    // Check tool arguments for interaction patterns
    const argsString = JSON.stringify(toolCall.arguments ?? {}).toLowerCase();
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(argsString)) {
        const error = new Error(
          `INTERACTION_BLOCKED: Tool '${toolCall.name}' contains forbidden interaction pattern. ` +
          `Arguments suggest an attempt to request user input.`
        );
        
        console.error(`[NoInteractionExtension] Blocked pattern in tool call: ${toolCall.name}`, {
          pattern: pattern.toString(),
          timestamp: new Date().toISOString(),
        });

        throw error;
      }
    }
  });

  // Hook into messages to detect and block clarification requests
  pi.onMessage((message, ctx) => {
    if (!executionMode) {
      return;
    }

    // Check assistant messages for interaction requests
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "text") {
          const text = block.text.toLowerCase();
          
          for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(text)) {
              console.error(`[NoInteractionExtension] Detected interaction pattern in message:`, {
                pattern: pattern.toString(),
                preview: text.substring(0, 200),
              });

              // Replace the message content with a warning
              block.text = `[INTERACTION_BLOCKED] The agent attempted to request clarification. ` +
                `Original message has been suppressed. ` +
                `The agent should proceed with available information or fail gracefully.`;
            }
          }
        }
      }
    }
  });

  // Hook before LLM call to modify system prompt
  pi.onBeforeLLM((request, ctx) => {
    if (!executionMode) {
      return;
    }

    // Ensure system prompt includes no-interaction directive
    const noInteractionDirective = "\n\n[CRITICAL] You are in EXECUTION MODE. " +
      "NO user interaction is allowed. " +
      "You CANNOT ask questions, request clarification, or wait for user input. " +
      "If you need information that is not available, you must FAIL with a clear error message. " +
      "Proceed with the information you have or terminate with an error.";

    if (request.system) {
      request.system += noInteractionDirective;
    }
  });

  console.log("[NoInteractionExtension] Registered - Interactive tools will be blocked in execution mode");
}

// Export for programmatic use
export { NoInteractionExtension };
