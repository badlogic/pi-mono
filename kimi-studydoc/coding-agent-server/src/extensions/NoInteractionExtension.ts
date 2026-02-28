import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@mariozechner/pi-coding-agent";

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

export interface NoInteractionOptions {
  enabled?: boolean;
}

export default function NoInteractionExtension(pi: ExtensionAPI, options: NoInteractionOptions = {}): void {
  // Track if we're in execution mode
  let executionMode = options.enabled ?? false;

  // Subscribe to tool_call events
  pi.on("tool_call", (event: ToolCallEvent, _ctx: ExtensionContext) => {
    if (!executionMode) {
      return; // Allow in non-execution mode
    }

    const toolName = event.toolName.toLowerCase();

    // Check if tool is in forbidden list
    if (FORBIDDEN_TOOLS.includes(toolName)) {
      const error = new Error(
        `INTERACTION_BLOCKED: Tool '${event.toolName}' is not allowed in execution mode. ` +
        `The agent attempted to request user interaction during a non-interactive execution phase. ` +
        `This indicates either:\n` +
        `1. The skill requires information that should have been provided during preflight\n` +
        `2. The agent encountered an unexpected situation\n` +
        `3. The skill is not designed for autonomous execution`
      );
      
      // Log the violation
      console.error(`[NoInteractionExtension] Blocked tool call: ${event.toolName}`, {
        toolCallId: event.toolCallId,
        timestamp: new Date().toISOString(),
      });

      // Throw to block execution
      throw error;
    }
  });

  // Subscribe to before_agent_start to modify system prompt
  pi.on("before_agent_start", (event, _ctx) => {
    if (!executionMode) {
      return;
    }

    // Ensure system prompt includes no-interaction directive
    const noInteractionDirective = "\n\n[CRITICAL] You are in EXECUTION MODE. " +
      "NO user interaction is allowed. " +
      "You CANNOT ask questions, request clarification, or wait for user input. " +
      "If you need information that is not available, you must FAIL with a clear error message. " +
      "Proceed with the information you have or terminate with an error.";

    return {
      systemPrompt: (event.systemPrompt ?? "") + noInteractionDirective,
    };
  });

  console.log("[NoInteractionExtension] Registered - Interactive tools will be blocked in execution mode");
}

// Export for programmatic use
export { NoInteractionExtension };
