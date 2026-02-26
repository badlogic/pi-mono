import express, { type Request, type Response } from "express";
import { AgentService, type AgentConfig, type AgentSessionEvent } from "./agent-service.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const REPO_PATH = process.env.REPO_PATH || "/app/repo";
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "";
const PROVIDER = process.env.PROVIDER || "anthropic";
const MODEL_ID = process.env.MODEL_ID || "claude-sonnet-4-20250514";
const THINKING_LEVEL = (process.env.THINKING_LEVEL as AgentConfig["thinkingLevel"]) || "medium";
const PORT = parseInt(process.env.PORT || "3000", 10);

let agentService: AgentService | null = null;

async function getAgentService(): Promise<AgentService> {
	if (!agentService) {
		console.log(`[Agent] Initializing agent for repo: ${REPO_PATH}`);
		agentService = new AgentService({
			repoPath: REPO_PATH,
			apiKey: API_KEY,
			provider: PROVIDER,
			modelId: MODEL_ID,
			thinkingLevel: THINKING_LEVEL,
		});
		await agentService.initialize();
		console.log("[Agent] Agent initialized successfully");
	}
	return agentService;
}

app.post("/analyze", async (req: Request, res: Response): Promise<void> => {
	const startTime = Date.now();
	try {
		const { prompt } = req.body;

		if (!prompt) {
			res.status(400).json({ error: "prompt is required" });
			return;
		}

		console.log(`[Analyze] Received prompt: ${prompt.substring(0, 100)}...`);

		const agent = await getAgentService();
		const result = await agent.analyze(prompt);

		const duration = Date.now() - startTime;
		console.log(`[Analyze] Completed in ${duration}ms, ${result.toolCalls.length} tool calls`);

		res.json({
			...result,
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

		console.log(`[Stream] Received prompt: ${prompt.substring(0, 100)}...`);

		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.setHeader("X-Accel-Buffering", "no");

		const agent = await getAgentService();

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
		console.log(`[Stream] Completed in ${duration}ms`);

		const doneData = JSON.stringify({
			type: "done",
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

		console.log(`[Chat] Received prompt: ${prompt.substring(0, 100)}...`);

		const agent = await getAgentService();
		const response = await agent.chat(prompt);

		const duration = Date.now() - startTime;
		console.log(`[Chat] Completed in ${duration}ms`);

		res.json({
			success: true,
			response,
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
		const agent = await getAgentService();
		const messages = agent.getMessages();
		res.json({
			success: true,
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

app.get("/health", (req: Request, res: Response): void => {
	res.json({
		status: "ok",
		config: {
			repoPath: REPO_PATH,
			provider: PROVIDER,
			modelId: MODEL_ID,
			thinkingLevel: THINKING_LEVEL,
			hasApiKey: !!API_KEY,
		},
	});
});

app.post("/reset", async (req: Request, res: Response): Promise<void> => {
	try {
		if (agentService) {
			await agentService.dispose();
			agentService = null;
			console.log("[Reset] Agent disposed");
		}
		res.json({ success: true, message: "Agent reset successfully" });
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
	console.log(`  - Thinking level: ${THINKING_LEVEL}`);
	console.log(`  - API key configured: ${!!API_KEY}`);
	console.log(`\nEndpoints:`);
	console.log(`  POST /analyze        - Analyze code (returns full result)`);
	console.log(`  POST /analyze/stream - Analyze code (SSE streaming)`);
	console.log(`  POST /chat           - Simple chat`);
	console.log(`  GET  /messages       - Get conversation history`);
	console.log(`  GET  /health         - Health check`);
	console.log(`  POST /reset          - Reset agent session`);
});

process.on("SIGTERM", async () => {
	console.log("SIGTERM received, shutting down...");
	if (agentService) {
		await agentService.dispose();
	}
	server.close(() => {
		console.log("Server closed");
		process.exit(0);
	});
});

process.on("SIGINT", async () => {
	console.log("SIGINT received, shutting down...");
	if (agentService) {
		await agentService.dispose();
	}
	server.close(() => {
		console.log("Server closed");
		process.exit(0);
	});
});
