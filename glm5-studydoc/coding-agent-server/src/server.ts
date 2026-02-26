import express, { type Request, type Response } from "express";
import { AgentService, type AgentConfig, type AgentSessionEvent } from "./agent-service.js";
import { AgentSessionManager } from "./session-manager.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const REPO_PATH = process.env.REPO_PATH || "/app/repo";
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "";
const PROVIDER = process.env.PROVIDER || "anthropic";
const MODEL_ID = process.env.MODEL_ID || "claude-sonnet-4-20250514";
const THINKING_LEVEL = (process.env.THINKING_LEVEL as AgentConfig["thinkingLevel"]) || "medium";
const PORT = parseInt(process.env.PORT || "3000", 10);

// OpenAI-compatible API configuration
const BASE_URL = process.env.BASE_URL || ""; // e.g., https://xxxx.yy/v1
const CUSTOM_MODEL_ID = process.env.CUSTOM_MODEL_ID || ""; // Your custom model ID

// Session manager configuration
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "5", 5);
const SESSION_IDLE_TIMEOUT_MS = parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || "1800000", 10); // 30 minutes
const SESSION_MAX_LIFETIME_MS = parseInt(process.env.SESSION_MAX_LIFETIME_MS || "7200000", 10); // 2 hours

// Initialize session manager
const sessionManager = new AgentSessionManager({
	maxSessions: MAX_SESSIONS,
	idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
	maxLifetimeMs: SESSION_MAX_LIFETIME_MS,
});

/**
 * Get or create session from request
 */
async function getSessionFromRequest(req: Request): Promise<{ sessionId: string; agent: AgentService }> {
	const sessionId = (req.headers["x-session-id"] as string) || "default";

	// Support system prompt from request body (for POST requests)
	const requestSystemPrompt = req.body?.systemPrompt as string | undefined;

	const config: AgentConfig = {
		repoPath: REPO_PATH,
		apiKey: API_KEY,
		provider: PROVIDER,
		modelId: CUSTOM_MODEL_ID || MODEL_ID,
		thinkingLevel: THINKING_LEVEL,
		baseUrl: BASE_URL || undefined,
		systemPrompt: requestSystemPrompt,
	};

	const agent = await sessionManager.getSession(sessionId, config);
	return { sessionId, agent };
}

app.post("/analyze", async (req: Request, res: Response): Promise<void> => {
	const startTime = Date.now();
	try {
		const { prompt } = req.body;

		if (!prompt) {
			res.status(400).json({ error: "prompt is required" });
			return;
		}

		const { sessionId, agent } = await getSessionFromRequest(req);
		console.log(`[Analyze] Session: ${sessionId}, Prompt: ${prompt.substring(0, 100)}...`);

		const result = await agent.analyze(prompt);

		const duration = Date.now() - startTime;
		console.log(`[Analyze] Session: ${sessionId}, Completed in ${duration}ms, ${result.toolCalls.length} tool calls`);

		res.json({
			...result,
			sessionId,
			duration,
		});
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error(`[Analyze] Error after ${duration}ms:`, error);
		res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
			duration,
		});
	}
});

app.post("/analyze/stream", async (req: Request, res: Response): Promise<void> => {
	const startTime = Date.now();
	try {
		const { prompt } = req.body;

		if (!prompt) {
			res.status(400).json({ error: "prompt is required" });
			return;
		}

		const { sessionId, agent } = await getSessionFromRequest(req);
		console.log(`[Stream] Session: ${sessionId}, Prompt: ${prompt.substring(0, 100)}...`);

		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.setHeader("X-Accel-Buffering", "no");

		const result = await agent.analyze(prompt, (event: AgentSessionEvent) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				const data = JSON.stringify({
					type: "delta",
					text: event.assistantMessageEvent.delta,
				});
				res.write(`data: ${data}\n\n`);
			} else if (event.type === "tool_execution_start") {
				const data = JSON.stringify({
					type: "tool_start",
					toolName: event.toolName,
					args: event.args,
				});
				res.write(`data: ${data}\n\n`);
			} else if (event.type === "tool_execution_end") {
				const data = JSON.stringify({
					type: "tool_end",
					toolName: event.toolName,
					isError: event.isError,
				});
				res.write(`data: ${data}\n\n`);
			}
		});

		const duration = Date.now() - startTime;
		console.log(`[Stream] Session: ${sessionId}, Completed in ${duration}ms`);

		const doneData = JSON.stringify({
			type: "done",
			sessionId,
			result: {
				...result,
				duration,
			},
		});
		res.write(`data: ${doneData}\n\n`);
		res.end();
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error(`[Stream] Error after ${duration}ms:`, error);
		const errorData = JSON.stringify({
			type: "error",
			message: error instanceof Error ? error.message : "Unknown error",
		});
		res.write(`data: ${errorData}\n\n`);
		res.end();
	}
});

app.post("/chat", async (req: Request, res: Response): Promise<void> => {
	const startTime = Date.now();
	try {
		const { prompt } = req.body;

		if (!prompt) {
			res.status(400).json({ error: "prompt is required" });
			return;
		}

		const { sessionId, agent } = await getSessionFromRequest(req);
		console.log(`[Chat] Session: ${sessionId}, Prompt: ${prompt.substring(0, 100)}...`);

		const response = await agent.chat(prompt);

		const duration = Date.now() - startTime;
		console.log(`[Chat] Session: ${sessionId}, Completed in ${duration}ms`);

		res.json({
			success: true,
			response,
			sessionId,
			duration,
		});
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error(`[Chat] Error after ${duration}ms:`, error);
		res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
			duration,
		});
	}
});

app.get("/messages", async (req: Request, res: Response): Promise<void> => {
	try {
		const { sessionId, agent } = await getSessionFromRequest(req);
		const messages = agent.getMessages();
		res.json({
			success: true,
			sessionId,
			count: messages.length,
			messages,
		});
	} catch (error) {
		console.error("[Messages] Error:", error);
		res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

app.post("/summarize", async (req: Request, res: Response): Promise<void> => {
	const startTime = Date.now();
	try {
		const { sessionId, agent } = await getSessionFromRequest(req);
		console.log(`[Summarize] Session: ${sessionId}`);

		const summary = await agent.summarize();

		const duration = Date.now() - startTime;
		console.log(`[Summarize] Session: ${sessionId}, Completed in ${duration}ms`);

		res.json({
			success: true,
			summary,
			sessionId,
			duration,
		});
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error(`[Summarize] Error after ${duration}ms:`, error);
		res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
			duration,
		});
	}
});

app.get("/health", (req: Request, res: Response): void => {
	const stats = sessionManager.getStats();
	res.json({
		status: "ok",
		sessions: stats,
		config: {
			repoPath: REPO_PATH,
			provider: PROVIDER,
			modelId: MODEL_ID,
			thinkingLevel: THINKING_LEVEL,
			hasApiKey: !!API_KEY,
			maxSessions: MAX_SESSIONS,
			sessionIdleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
			sessionMaxLifetimeMs: SESSION_MAX_LIFETIME_MS,
		},
	});
});

/**
 * Get session statistics
 */
app.get("/sessions", (req: Request, res: Response): void => {
	const sessions = sessionManager.listSessions();
	const stats = sessionManager.getStats();
	res.json({
		success: true,
		sessions,
		stats,
	});
});

/**
 * Destroy a specific session
 */
app.delete("/sessions/:sessionId", async (req: Request, res: Response): Promise<void> => {
	try {
		const { sessionId } = req.params;
		const destroyed = await sessionManager.destroySession(sessionId);

		if (destroyed) {
			res.json({
				success: true,
				message: `Session ${sessionId} destroyed`,
			});
		} else {
			res.status(404).json({
				success: false,
				error: `Session ${sessionId} not found`,
			});
		}
	} catch (error) {
		console.error("[Delete Session] Error:", error);
		res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

/**
 * Reset current session (from X-Session-Id header)
 */
app.post("/reset", async (req: Request, res: Response): Promise<void> => {
	try {
		const sessionId = (req.headers["x-session-id"] as string) || "default";
		const destroyed = await sessionManager.destroySession(sessionId);

		if (destroyed) {
			console.log(`[Reset] Session ${sessionId} destroyed`);
			res.json({
				success: true,
				message: `Session ${sessionId} reset successfully`,
			});
		} else {
			res.json({
				success: true,
				message: `Session ${sessionId} was not active`,
			});
		}
	} catch (error) {
		console.error("[Reset] Error:", error);
		res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

const server = app.listen(PORT, "0.0.0.0", () => {
	console.log(`Coding Agent Server running on port ${PORT}`);
	console.log(`Configuration:`);
	console.log(`  - Repo path: ${REPO_PATH}`);
	console.log(`  - Provider: ${PROVIDER}`);
	console.log(`  - Model: ${MODEL_ID}`);
	console.log(`  - Custom Model: ${CUSTOM_MODEL_ID || "(not set)"}`);
	console.log(`  - Base URL: ${BASE_URL || "(using provider default)"}`);
	console.log(`  - Thinking level: ${THINKING_LEVEL}`);
	console.log(`  - API key configured: ${!!API_KEY}`);
	console.log(`  - Max sessions: ${MAX_SESSIONS}`);
	console.log(`  - Session idle timeout: ${SESSION_IDLE_TIMEOUT_MS}ms`);
	console.log(`  - Session max lifetime: ${SESSION_MAX_LIFETIME_MS}ms`);
	console.log(`\nEndpoints:`);
	console.log(`  POST /analyze        - Analyze code (returns full result)`);
	console.log(`  POST /analyze/stream - Analyze code (SSE streaming)`);
	console.log(`  POST /chat           - Simple chat`);
	console.log(`  GET  /messages       - Get conversation history`);
	console.log(`  GET  /health         - Health check with session stats`);
	console.log(`  GET  /sessions       - List all active sessions`);
	console.log(`  DELETE /sessions/:id - Destroy specific session`);
	console.log(`  POST /reset          - Reset current session`);
	console.log(`\nHeaders:`);
	console.log(`  X-Session-Id         - Session identifier (default: "default")`);
});

process.on("SIGTERM", async () => {
	console.log("SIGTERM received, shutting down...");
	await sessionManager.dispose();
	server.close(() => {
		console.log("Server closed");
		process.exit(0);
	});
});

process.on("SIGINT", async () => {
	console.log("SIGINT received, shutting down...");
	await sessionManager.dispose();
	server.close(() => {
		console.log("Server closed");
		process.exit(0);
	});
});
