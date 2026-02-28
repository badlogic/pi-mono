import { createAgentSession, createBashTool, createReadTool, createWriteTool, createEditTool, createGrepTool, createFindTool, createLsTool, AuthStorage, ModelRegistry, SettingsManager } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Snapshot } from "./types.js";
import type { SessionManager } from "./SessionManager.js";
import NoInteractionExtension from "./extensions/NoInteractionExtension.js";
import PersistenceExtension from "./extensions/PersistenceExtension.js";
import { createEventBus } from "@mariozechner/pi-coding-agent";

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

      // Create agent session
      const { session: agentSession, extensionsResult } = await createAgentSession({
        cwd: this.workingDir,
        agentDir: this.agentDir,
        model,
        thinkingLevel: "off",
        authStorage,
        modelRegistry,
        settingsManager,
        tools,
      });

      // Register NoInteractionExtension
      const eventBus = createEventBus();
      const noInteractionApi = createExtensionAPI(extensionsResult.runtime, eventBus, this.workingDir);
      await NoInteractionExtension(noInteractionApi, { enabled: true });

      // Register PersistenceExtension
      const persistenceApi = createExtensionAPI(extensionsResult.runtime, eventBus, this.workingDir);
      await PersistenceExtension(persistenceApi, {
        sessionId,
        onSave: async (messages, state) => {
          await this.sessionManager.updateMessageHistory(sessionId, messages);
          console.log(`[PersistenceExtension] Saved ${messages.length} messages at step ${state.stepIndex}`);
        },
        onLoad: async () => {
          const savedSession = await this.sessionManager.getSession(sessionId);
          if (savedSession?.messageHistory) {
            return {
              messages: savedSession.messageHistory,
              state: {
                sessionId,
                stepIndex: savedSession.currentStep ?? 0,
                totalSteps: savedSession.totalSteps ?? 0,
                checkpointAt: Date.now(),
              },
            };
          }
          return null;
        },
      });

      // Set custom system prompt
      agentSession.agent.setSystemPrompt(systemPrompt);

      // Restore message history if resuming
      if (session.messageHistory && session.messageHistory.length > 0) {
        agentSession.agent.replaceMessages(session.messageHistory);
        console.log(`[ExecutionRunner] Restored ${session.messageHistory.length} messages from history`);
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

          case "tool_execution_start":
            stepsExecuted++;
            console.log(`\n[Step ${stepsExecuted}/${this.maxSteps}] Tool: ${event.toolName}`);
            
            // Save progress
            this.sessionManager.updateProgress(sessionId, stepsExecuted, this.maxSteps);
            
            // Check step limit
            if (stepsExecuted >= this.maxSteps) {
              console.log("[ExecutionRunner] Max steps reached, stopping execution");
              abortController.abort();
            }
            break;

          case "tool_execution_end":
            // Tool completed
            break;

          case "agent_end":
            // Agent finished
            break;
        }
      });

      // Send the initial prompt using prompt() method
      await agentSession.prompt(session.snapshot.prompt);

      // Wait for completion or abort
      await this.waitForCompletion(abortController.signal);

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
    // Interactive tools that are NEVER allowed in execution mode
    const FORBIDDEN_TOOLS = new Set([
      "ask_user",
      "question",
      "clarify",
      "confirm",
      "prompt",
      "input",
      "select",
      "questionnaire",
      "human",
      "user_input",
    ]);

    // Base non-interactive tools allowed in execution mode
    const ALLOWED_TOOLS = new Set([
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
    ]);

    // Map of available tool factories
    const availableTools: Record<string, () => any> = {
      read: () => createReadTool(this.workingDir),
      write: () => createWriteTool(this.workingDir),
      edit: () => createEditTool(this.workingDir),
      bash: () => createBashTool(this.workingDir),
      grep: () => createGrepTool(this.workingDir),
      find: () => createFindTool(this.workingDir),
      ls: () => createLsTool(this.workingDir),
    };

    // Only add whitelisted tools that are not forbidden
    const tools: any[] = [];
    for (const toolName of whitelist) {
      const normalized = toolName.toLowerCase();
      
      // Skip forbidden interactive tools
      if (FORBIDDEN_TOOLS.has(normalized)) {
        console.warn(`[ExecutionRunner] Skipping forbidden tool: ${toolName}`);
        continue;
      }

      // Only allow known tools
      const toolFactory = availableTools[normalized];
      if (toolFactory) {
        tools.push(toolFactory());
      } else if (ALLOWED_TOOLS.has(normalized)) {
        console.warn(`[ExecutionRunner] Tool ${toolName} is allowed but not available in factory`);
      }
    }

    console.log(`[ExecutionRunner] Created ${tools.length} restricted tools from whitelist of ${whitelist.length} tools`);
    return tools;
  }

  private async waitForCompletion(
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

// Helper function to create ExtensionAPI for registering extensions
function createExtensionAPI(
  runtime: any,
  _eventBus: any,
  _cwd: string,
): any {
  const handlers = new Map<string, any[]>();

  return {
    on(event: string, handler: (...args: any[]) => void): void {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);

      // Register handler with runtime
      if (runtime && typeof runtime.on === "function") {
        runtime.on(event, handler);
      }
    },

    registerTool(_tool: any): void {
      // Tool registration not needed for these extensions
    },

    registerCommand(_name: string, _options: any): void {
      // Command registration not needed
    },

    registerShortcut(_shortcut: string, _options: any): void {
      // Shortcut registration not needed
    },

    registerFlag(_name: string, _options: any): void {
      // Flag registration not needed
    },

    getFlag(_name: string): boolean | string | undefined {
      return undefined;
    },

    sendMessage(_message: any, _options?: any): void {
      // Not needed for these extensions
    },

    sendUserMessage(_content: any, _options?: any): void {
      // Not needed
    },

    appendEntry(_customType: string, _data?: any): void {
      // Not needed
    },

    setSessionName(_name: string): void {
      // Not needed
    },

    getSessionName(): string | undefined {
      return undefined;
    },

    setLabel(_entryId: string, _label: string | undefined): void {
      // Not needed
    },

    exec(_command: string, _args: string[], _options?: any): any {
      // Not needed
    },

    getActiveTools(): string[] {
      return [];
    },

    getAllTools(): any {
      return [];
    },

    setActiveTools(_toolNames: string[]): void {
      // Not needed
    },

    getCommands(): any {
      return {};
    },

    setModel(_model: any): void {
      // Not needed
    },

    getThinkingLevel(): string {
      return "off";
    },

    setThinkingLevel(_level: string): void {
      // Not needed
    },

    registerProvider(_name: string, _config: any): void {
      // Not needed
    },
  };
}
