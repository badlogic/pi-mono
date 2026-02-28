import type { ExtensionAPI, ExtensionContext, ToolCallContext, AgentMessage } from "@mariozechner/pi-coding-agent";

/**
 * PersistenceExtension
 * 
 * This extension ensures that:
 * 1. Message history is saved after each tool call
 * 2. Execution state can be restored after crash
 * 3. Progress is tracked and persisted
 * 
 * This enables crash recovery for long-running tasks.
 */

interface PersistenceState {
  sessionId: string;
  stepIndex: number;
  totalSteps: number;
  lastToolCall?: {
    name: string;
    timestamp: number;
  };
  checkpointAt: number;
}

export interface PersistenceOptions {
  sessionId: string;
  onSave: (messages: AgentMessage[], state: PersistenceState) => Promise<void>;
  onLoad: () => Promise<{ messages: AgentMessage[]; state: PersistenceState } | null>;
  saveInterval?: number; // milliseconds between forced saves
}

export default function PersistenceExtension(pi: ExtensionAPI, options: PersistenceOptions): void {
  let stepIndex = 0;
  let totalSteps = 0;
  let lastSaveTime = Date.now();
  let messageHistory: AgentMessage[] = [];
  
  const saveInterval = options.saveInterval ?? 5000; // Default 5 seconds

  // Register command to set total steps
  pi.registerCommand("set-total-steps", {
    description: "Set the total number of steps for progress tracking",
    async run(ctx: ExtensionContext, args: { count: number }) {
      totalSteps = args.count;
      console.log(`[PersistenceExtension] Total steps set to: ${totalSteps}`);
    },
  });

  // Register command to get current progress
  pi.registerCommand("get-progress", {
    description: "Get current execution progress",
    async run(ctx: ExtensionContext) {
      const progress = totalSteps > 0 ? Math.round((stepIndex / totalSteps) * 100) : 0;
      ctx.ui.notify(`Progress: ${stepIndex}/${totalSteps} (${progress}%)`);
    },
  });

  // Hook into messages to track history
  pi.onMessage((message, ctx) => {
    messageHistory.push(message);
    
    // Check if we should force a save
    const now = Date.now();
    if (now - lastSaveTime > saveInterval) {
      saveState();
    }
  });

  // Hook into tool calls to save after each execution
  pi.onToolCall(async (toolCall, ctx: ToolCallContext) => {
    stepIndex++;
    
    const state: PersistenceState = {
      sessionId: options.sessionId,
      stepIndex,
      totalSteps,
      lastToolCall: {
        name: toolCall.name,
        timestamp: Date.now(),
      },
      checkpointAt: Date.now(),
    };

    try {
      await options.onSave(messageHistory, state);
      lastSaveTime = Date.now();
      
      console.log(`[PersistenceExtension] Checkpoint saved at step ${stepIndex}/${totalSteps}`);
    } catch (error) {
      console.error("[PersistenceExtension] Failed to save state:", error);
      // Don't throw - we don't want to break execution due to persistence failure
    }
  });

  // Hook after LLM to save state
  pi.onAfterLLM(async (response, ctx) => {
    const state: PersistenceState = {
      sessionId: options.sessionId,
      stepIndex,
      totalSteps,
      checkpointAt: Date.now(),
    };

    try {
      await options.onSave(messageHistory, state);
    } catch (error) {
      console.error("[PersistenceExtension] Failed to save after LLM:", error);
    }
  });

  // Helper function to save state
  async function saveState(): Promise<void> {
    const state: PersistenceState = {
      sessionId: options.sessionId,
      stepIndex,
      totalSteps,
      checkpointAt: Date.now(),
    };

    try {
      await options.onSave(messageHistory, state);
      lastSaveTime = Date.now();
    } catch (error) {
      console.error("[PersistenceExtension] Failed to save state:", error);
    }
  }

  // Register restore command
  pi.registerCommand("restore-session", {
    description: "Restore session from last checkpoint",
    async run(ctx: ExtensionContext) {
      try {
        const restored = await options.onLoad();
        if (restored) {
          messageHistory = restored.messages;
          stepIndex = restored.state.stepIndex;
          totalSteps = restored.state.totalSteps;
          
          ctx.ui.notify(`Session restored: step ${stepIndex}/${totalSteps}`);
          console.log("[PersistenceExtension] Session restored from checkpoint");
        } else {
          ctx.ui.notify("No checkpoint found - starting fresh");
        }
      } catch (error) {
        console.error("[PersistenceExtension] Failed to restore session:", error);
        ctx.ui.notify("Failed to restore session");
      }
    },
  });

  console.log(`[PersistenceExtension] Registered for session: ${options.sessionId}`);
}

// Export for programmatic use
export { PersistenceExtension };
export type { PersistenceState };
