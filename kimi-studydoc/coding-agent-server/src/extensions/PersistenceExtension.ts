import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

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

  // Subscribe to message_end events to track history
  pi.on("message_end", (event) => {
    messageHistory.push(event.message);
    
    // Check if we should force a save
    const now = Date.now();
    if (now - lastSaveTime > saveInterval) {
      saveState();
    }
  });

  // Subscribe to tool_execution_end to save after each execution
  pi.on("tool_execution_end", async (event) => {
    stepIndex++;
    
    const state: PersistenceState = {
      sessionId: options.sessionId,
      stepIndex,
      totalSteps,
      lastToolCall: {
        name: event.toolName,
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

  console.log(`[PersistenceExtension] Registered for session: ${options.sessionId}`);
}

// Export for programmatic use
export { PersistenceExtension };
export type { PersistenceState };
