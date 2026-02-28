import { createAgentSession, createBashTool, createReadTool, createWriteTool, createEditTool, AuthStorage, ModelRegistry, SettingsManager, SessionManager as CodingSessionManager } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Session, Snapshot } from "./types.js";
import type { SessionManager } from "./SessionManager.js";

export interface ExecutionRunnerOptions {
  sessionManager: SessionManager;
  workingDir: string;
  agentDir: string;
  provider?: string;
  modelId?: string;
  apiKey?: string;
  maxSteps?: number;
}

export interface ExecutionResult {
  success: boolean;
  messages: AgentMessage[];
  stepsExecuted: number;
  error?: string;
}

export class ExecutionRunner {
  private sessionManager: SessionManager;
  private workingDir: string;
  private agentDir: string;
  private provider: string;
  private modelId: string;
  private apiKey?: string;
  private maxSteps: number;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(options: ExecutionRunnerOptions) {
    this.sessionManager = options.sessionManager;
    this.workingDir = options.workingDir;
    this.agentDir = options.agentDir;
    this.provider = options.provider ?? "anthropic";
    this.modelId = options.modelId ?? "claude-sonnet-4-5";
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.maxSteps = options.maxSteps ?? 100;
  }

  async execute(sessionId: string): Promise<ExecutionResult> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      return {
        success: false,
        messages: [],
        stepsExecuted: 0,
        error: `Session ${sessionId} not found`,
      };
    }

    if (!session.snapshot) {
      return {
        success: false,
        messages: [],
        stepsExecuted: 0,
        error: "Session has no snapshot - cannot execute",
      };
    }

    // Create abort controller for this session
    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);

    try {
      // Update session state
      await this.sessionManager.transitionTo(sessionId, "EXECUTING");

      // Build system prompt from snapshot
      const systemPrompt = this.buildSystemPrompt(session.snapshot);

      // Create auth storage
      const authStorage = AuthStorage.create(this.agentDir);
      if (this.apiKey) {
        authStorage.setRuntimeApiKey(this.provider, this.apiKey);
      }

      // Get model
      const model = getModel(this.provider as any, this.modelId);
      if (!model) {
        throw new Error(`Model ${this.provider}/${this.modelId} not found`);
      }

      // Create model registry
      const modelRegistry = new ModelRegistry(authStorage);

      // Create settings manager
      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: true, maxRetries: 2 },
      });

      // Create restricted tools based on whitelist
      const tools = this.createRestrictedTools(session.snapshot.toolWhitelist);

      // Create coding session manager
      const codingSessionManager = CodingSessionManager.inMemory();

      // Create agent session
      const { session: agentSession } = await createAgentSession({
        cwd: this.workingDir,
        agentDir: this.agentDir,
        model,
        thinkingLevel: "off",
        authStorage,
        modelRegistry,
        settingsManager,
        tools,
        sessionManager: codingSessionManager,
        systemPrompt,
      });

      // Restore message history if resuming
      if (session.messageHistory && session.messageHistory.length > 0) {
        // Note: This would require SDK support for loading history
        console.log(`[ExecutionRunner] Restoring ${session.messageHistory.length} messages`);
      }

      // Execute the task
      const messages: AgentMessage[] = [];
      let stepsExecuted = 0;

      // Subscribe to events
      agentSession.subscribe((event) => {
        if (abortController.signal.aborted) {
          return;
        }

        switch (event.type) {
          case "message_update":
            // Track messages
            if (event.assistantMessageEvent.type === "text_delta") {
              // Stream output
              process.stdout.write(event.assistantMessageEvent.delta);
            }
            break;

          case "tool_call":
            stepsExecuted++;
            console.log(`\n[Step ${stepsExecuted}/${this.maxSteps}] Tool: ${event.toolCall.name}`);
            
            // Save progress
            this.sessionManager.updateProgress(sessionId, stepsExecuted, this.maxSteps);
            
            // Check step limit
            if (stepsExecuted >= this.maxSteps) {
              console.log("[ExecutionRunner] Max steps reached, stopping execution");
              abortController.abort();
            }
            break;

          case "tool_result":
            // Tool completed
            break;

          case "error":
            console.error("[ExecutionRunner] Error:", event.error);
            break;
        }
      });

      // Send the initial prompt
      await agentSession.sendMessage({
        role: "user",
        content: session.snapshot.prompt,
      });

      // Wait for completion or abort
      await this.waitForCompletion(agentSession, abortController.signal);

      // Update session state
      if (abortController.signal.aborted) {
        await this.sessionManager.transitionTo(sessionId, "PAUSED");
        return {
          success: false,
          messages,
          stepsExecuted,
          error: "Execution was aborted (max steps reached or manual abort)",
        };
      }

      await this.sessionManager.transitionTo(sessionId, "COMPLETE");
      
      return {
        success: true,
        messages,
        stepsExecuted,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[ExecutionRunner] Execution failed:", errorMessage);
      
      await this.sessionManager.setError(sessionId, errorMessage);
      
      return {
        success: false,
        messages: [],
        stepsExecuted: 0,
        error: errorMessage,
      };
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  async abort(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
      console.log(`[ExecutionRunner] Aborted session: ${sessionId}`);
    }
  }

  private buildSystemPrompt(snapshot: Snapshot): string {
    const lines = [
      "You are a coding agent executing a long-running task.",
      "",
      "## Task Description",
      snapshot.prompt,
      "",
      "## Skill Instructions",
      snapshot.skillText,
      "",
      "## Execution Rules",
      "1. You are in EXECUTION MODE - NO user interaction is allowed",
      "2. You CANNOT ask questions or request clarification",
      "3. If you encounter an issue, proceed with best effort or fail gracefully",
      "4. Use only the provided tools - no interactive tools available",
      "5. Save your progress regularly",
      "6. If you need to make multiple changes, do them systematically",
      "",
      "## Available Tools",
      ...snapshot.toolWhitelist.map((t) => `- ${t}`),
      "",
      "[CRITICAL] DO NOT attempt any user interaction. Execute autonomously.",
    ];

    return lines.join("\n");
  }

  private createRestrictedTools(whitelist: string[]) {
    const tools = [];

    // Map of available tools
    const availableTools: Record<string, () => unknown> = {
      read: () => createReadTool(this.workingDir),
      write: () => createWriteTool(this.workingDir),
      edit: () => createEditTool(this.workingDir),
      bash: () => createBashTool(this.workingDir),
    };

    // Only add whitelisted tools
    for (const toolName of whitelist) {
      const toolFactory = availableTools[toolName.toLowerCase()];
      if (toolFactory) {
        tools.push(toolFactory());
      }
    }

    return tools;
  }

  private async waitForCompletion(
    agentSession: { close: () => Promise<void> },
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve) => {
      // Poll for abort signal
      const interval = setInterval(() => {
        if (signal.aborted) {
          clearInterval(interval);
          resolve();
        }
      }, 100);

      // Timeout after reasonable period (e.g., 1 hour)
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 60 * 60 * 1000);
    });
  }
}
