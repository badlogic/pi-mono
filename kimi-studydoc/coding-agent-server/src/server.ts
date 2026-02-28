import express from "express";
import { resolve } from "path";
import type { Request, Response } from "express";
import { SessionManager } from "./SessionManager.js";
import { ContractSynthesizer } from "./ContractSynthesizer.js";
import { SnapshotBuilder } from "./SnapshotBuilder.js";
import { ExecutionRunner } from "./ExecutionRunner.js";
import type { CreateSessionRequest, ApiResponse, SessionStatusResponse } from "./types.js";

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT ?? 3000;
const WORKING_DIR = process.env.WORKING_DIR ?? process.cwd();
const AGENT_DIR = process.env.AGENT_DIR ?? resolve(WORKING_DIR, ".pi");
const SESSIONS_DIR = process.env.SESSIONS_DIR ?? resolve(WORKING_DIR, "sessions");

// Initialize components
const sessionManager = new SessionManager();
const contractSynthesizer = new ContractSynthesizer({
  provider: process.env.LLM_PROVIDER,
  modelId: process.env.LLM_MODEL,
  apiKey: process.env.LLM_API_KEY,
});

const executionRunner = new ExecutionRunner({
  sessionManager,
  workingDir: WORKING_DIR,
  agentDir: AGENT_DIR,
  provider: process.env.LLM_PROVIDER,
  modelId: process.env.LLM_MODEL,
  apiKey: process.env.LLM_API_KEY,
  maxSteps: parseInt(process.env.MAX_STEPS ?? "100", 10),
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Create a new session
app.post("/api/sessions", async (req: Request, res: Response) => {
  try {
    const { userPrompt, skillText } = req.body as CreateSessionRequest;

    if (!userPrompt || !skillText) {
      res.status(400).json({
        success: false,
        error: "Missing required fields: userPrompt, skillText",
      } as ApiResponse<never>);
      return;
    }

    const session = await sessionManager.createSession(userPrompt, skillText);
    
    console.log(`[Server] Created session: ${session.id}`);
    
    res.status(201).json({
      success: true,
      data: {
        sessionId: session.id,
        state: session.state,
        createdAt: session.createdAt,
      },
    } as ApiResponse<{ sessionId: string; state: string; createdAt: number }>);
  } catch (error) {
    console.error("[Server] Failed to create session:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    } as ApiResponse<never>);
  }
});

// Get session status
app.get("/api/sessions/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      res.status(404).json({
        success: false,
        error: "Session not found",
      } as ApiResponse<never>);
      return;
    }

    const response: SessionStatusResponse = {
      sessionId: session.id,
      state: session.state,
      progress: session.totalSteps
        ? {
            current: session.currentStep ?? 0,
            total: session.totalSteps,
          }
        : undefined,
      error: session.error,
    };

    res.json({ success: true, data: response } as ApiResponse<SessionStatusResponse>);
  } catch (error) {
    console.error("[Server] Failed to get session:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    } as ApiResponse<never>);
  }
});

// List all sessions
app.get("/api/sessions", async (_req: Request, res: Response) => {
  try {
    const sessions = await sessionManager.listSessions();
    
    const data = sessions.map((s) => ({
      sessionId: s.id,
      state: s.state,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    res.json({ success: true, data } as ApiResponse<typeof data>);
  } catch (error) {
    console.error("[Server] Failed to list sessions:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    } as ApiResponse<never>);
  }
});

// Start preflight (contract synthesis)
app.post("/api/sessions/:sessionId/preflight", async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      res.status(404).json({
        success: false,
        error: "Session not found",
      } as ApiResponse<never>);
      return;
    }

    // Transition to contract synthesis
    await sessionManager.transitionTo(sessionId, "CONTRACT_SYNTHESIS");

    // Synthesize contract
    console.log(`[Server] Synthesizing contract for session: ${sessionId}`);
    const contract = await contractSynthesizer.synthesize(
      session.userPrompt,
      session.skillText,
    );

    // Save contract
    await sessionManager.updateContract(sessionId, contract);

    // Check if we can proceed
    if (contractSynthesizer.hasMissingInformation(contract)) {
      await sessionManager.transitionTo(sessionId, "PREFLIGHT");
      
      res.json({
        success: true,
        data: {
          canProceed: false,
          contract,
          missingInfo: contract.missingInformation,
          message: contractSynthesizer.formatMissingInfo(contract),
        },
      } as ApiResponse<{
        canProceed: boolean;
        contract: typeof contract;
        missingInfo: string[];
        message: string;
      }>);
      return;
    }

    // Transition to preflight complete
    await sessionManager.transitionTo(sessionId, "PREFLIGHT");

    res.json({
      success: true,
      data: {
        canProceed: true,
        contract,
        message: "All dependencies satisfied. Ready to freeze and execute.",
      },
    } as ApiResponse<{
      canProceed: boolean;
      contract: typeof contract;
      message: string;
    }>);
  } catch (error) {
    console.error("[Server] Preflight failed:", error);
    await sessionManager.setError(sessionId, error instanceof Error ? error.message : String(error));
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    } as ApiResponse<never>);
  }
});

// Freeze and execute
app.post("/api/sessions/:sessionId/execute", async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { workingDir } = req.body;
  
  try {
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      res.status(404).json({
        success: false,
        error: "Session not found",
      } as ApiResponse<never>);
      return;
    }

    if (!session.contract) {
      res.status(400).json({
        success: false,
        error: "Session has no contract. Run preflight first.",
      } as ApiResponse<never>);
      return;
    }

    if (contractSynthesizer.hasMissingInformation(session.contract)) {
      res.status(400).json({
        success: false,
        error: "Cannot execute: missing required information",
      } as ApiResponse<never>);
      return;
    }

    // Build snapshot
    const targetDir = workingDir ?? WORKING_DIR;
    const snapshotBuilder = new SnapshotBuilder({
      workingDir: targetDir,
      includeGitHash: true,
    });

    console.log(`[Server] Building snapshot for session: ${sessionId}`);
    const snapshot = await snapshotBuilder.build(
      session.userPrompt,
      session.skillText,
      session.contract,
    );

    // Save snapshot
    await sessionManager.updateSnapshot(sessionId, snapshot);
    await sessionManager.transitionTo(sessionId, "FROZEN");

    // Start execution in background
    console.log(`[Server] Starting execution for session: ${sessionId}`);
    
    // Respond immediately with accepted status
    res.status(202).json({
      success: true,
      data: {
        message: "Execution started",
        sessionId,
        snapshot: {
          createdAt: snapshot.createdAt,
          filesFrozen: Object.keys(snapshot.fileDigests).length,
          toolsWhitelisted: snapshot.toolWhitelist.length,
        },
      },
    } as ApiResponse<{
      message: string;
      sessionId: string;
      snapshot: {
        createdAt: number;
        filesFrozen: number;
        toolsWhitelisted: number;
      };
    }>);

    // Execute in background
    executionRunner.execute(sessionId).then((result) => {
      if (result.success) {
        console.log(`[Server] Execution completed for session: ${sessionId}`);
      } else {
        console.error(`[Server] Execution failed for session: ${sessionId}`, result.error);
      }
    }).catch((error) => {
      console.error(`[Server] Execution error for session: ${sessionId}`, error);
    });

  } catch (error) {
    console.error("[Server] Failed to start execution:", error);
    await sessionManager.setError(sessionId, error instanceof Error ? error.message : String(error));
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    } as ApiResponse<never>);
  }
});

// Abort execution
app.post("/api/sessions/:sessionId/abort", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = await sessionManager.getSession(sessionId);

    if (!session) {
      res.status(404).json({
        success: false,
        error: "Session not found",
      } as ApiResponse<never>);
      return;
    }

    if (session.state !== "EXECUTING") {
      res.status(400).json({
        success: false,
        error: `Cannot abort session in state: ${session.state}`,
      } as ApiResponse<never>);
      return;
    }

    await executionRunner.abort(sessionId);
    await sessionManager.transitionTo(sessionId, "PAUSED");

    res.json({
      success: true,
      data: { message: "Execution aborted" },
    } as ApiResponse<{ message: string }>);
  } catch (error) {
    console.error("[Server] Failed to abort execution:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    } as ApiResponse<never>);
  }
});

// Delete session
app.delete("/api/sessions/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    // Abort if executing
    const session = await sessionManager.getSession(sessionId);
    if (session?.state === "EXECUTING") {
      await executionRunner.abort(sessionId);
    }

    await sessionManager.deleteSession(sessionId);
    
    res.json({
      success: true,
      data: { message: "Session deleted" },
    } as ApiResponse<{ message: string }>);
  } catch (error) {
    console.error("[Server] Failed to delete session:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    } as ApiResponse<never>);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     Coding Agent Server - Long Running Task Executor       ║
╠════════════════════════════════════════════════════════════╣
║  Port:        ${PORT.toString().padEnd(47)}║
║  Working Dir: ${WORKING_DIR.padEnd(47)}║
║  Agent Dir:   ${AGENT_DIR.padEnd(47)}║
║  Sessions:    ${SESSIONS_DIR.padEnd(47)}║
╚════════════════════════════════════════════════════════════╝

API Endpoints:
  POST   /api/sessions              - Create new session
  GET    /api/sessions              - List all sessions
  GET    /api/sessions/:id          - Get session status
  POST   /api/sessions/:id/preflight - Run dependency check
  POST   /api/sessions/:id/execute   - Start execution
  POST   /api/sessions/:id/abort     - Abort execution
  DELETE /api/sessions/:id          - Delete session
  GET    /health                    - Health check
  `);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[Server] Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n[Server] Shutting down gracefully...");
  process.exit(0);
});
