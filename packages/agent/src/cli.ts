#!/usr/bin/env node
import chalk from "chalk";
import { createInterface } from "readline";
import type { AgentConfig } from "./agent.js";
import { Agent } from "./agent.js";
import { parseArgs, printHelp as printHelpArgs } from "./args.js";
import { ConsoleRenderer } from "./renderers/console-renderer.js";
import { JsonRenderer } from "./renderers/json-renderer.js";
import { TuiRenderer } from "./renderers/tui-renderer.js";
import { SessionManager } from "./session-manager.js";

// Define argument structure
const argDefs = {
	"base-url": {
		type: "string" as const,
		default: "https://api.openai.com/v1",
		description: "API base URL",
	},
	"api-key": {
		type: "string" as const,
		default: process.env.OPENAI_API_KEY || "",
		description: "API key",
		showDefault: "$OPENAI_API_KEY",
	},
	model: {
		type: "string" as const,
		default: "gpt-5-mini",
		description: "Model name",
	},
	api: {
		type: "string" as const,
		default: "completions",
		description: "API type",
		choices: [
			{ value: "completions", description: "OpenAI Chat Completions API (most models)" },
			{ value: "responses", description: "OpenAI Responses API (GPT-OSS models)" },
		],
	},
	"system-prompt": {
		type: "string" as const,
		default: "You are a helpful assistant.",
		description: "System prompt",
	},
	continue: {
		type: "flag" as const,
		alias: "c",
		description: "Continue previous session",
	},
	json: {
		type: "flag" as const,
		description: "Output as JSONL",
	},
	help: {
		type: "flag" as const,
		alias: "h",
		description: "Show this help message",
	},
};

interface JsonCommand {
	type: "message" | "interrupt";
	content?: string;
}

function printHelp(): void {
	const usage = `Usage: pi-agent [options] [messages...]

Examples:
# Single message (default OpenAI, GPT-5 Mini, OPENAI_API_KEY env var)
pi-agent "What is 2+2?"

# Multiple messages processed sequentially
pi-agent "What is 2+2?" "What about 3+3?"

# Interactive chat mode (no messages = interactive)
pi-agent

# Continue most recently modified session in current directory
pi-agent --continue "Follow up question"

# GPT-OSS via Groq
pi-agent --base-url https://api.groq.com/openai/v1 --api-key $GROQ_API_KEY --model openai/gpt-oss-120b

# GLM 4.5 via OpenRouter
pi-agent --base-url https://openrouter.ai/api/v1 --api-key $OPENROUTER_API_KEY --model z-ai/glm-4.5

# Claude via Anthropic (no prompt caching support - see https://docs.anthropic.com/en/api/openai-sdk)
pi-agent --base-url https://api.anthropic.com/v1 --api-key $ANTHROPIC_API_KEY --model claude-opus-4-1-20250805`;
	printHelpArgs(argDefs, usage);
}

async function runJsonInteractiveMode(config: AgentConfig, sessionManager: SessionManager): Promise<void> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false, // Don't interpret control characters
	});

	const renderer = new JsonRenderer();
	const agent = new Agent(config, renderer, sessionManager);
	let isProcessing = false;
	let pendingMessage: string | null = null;

	const processMessage = async (content: string): Promise<void> => {
		isProcessing = true;

		try {
			await agent.ask(content);
		} catch (e: any) {
			await renderer.on({ type: "error", message: e.message });
		} finally {
			isProcessing = false;

			// Process any pending message
			if (pendingMessage) {
				const msg = pendingMessage;
				pendingMessage = null;
				await processMessage(msg);
			}
		}
	};

	// Listen for lines from stdin
	rl.on("line", (line) => {
		try {
			const command = JSON.parse(line) as JsonCommand;

			switch (command.type) {
				case "interrupt":
					agent.interrupt();
					isProcessing = false;
					break;

				case "message":
					if (!command.content) {
						renderer.on({ type: "error", message: "Message content is required" });
						return;
					}

					if (isProcessing) {
						// Queue the message for when the agent is done
						pendingMessage = command.content;
					} else {
						processMessage(command.content);
					}
					break;

				default:
					renderer.on({ type: "error", message: `Unknown command type: ${(command as any).type}` });
			}
		} catch (e) {
			renderer.on({ type: "error", message: `Invalid JSON: ${e}` });
		}
	});

	// Wait for stdin to close
	await new Promise<void>((resolve) => {
		rl.on("close", () => {
			resolve();
		});
	});
}

async function runTuiInteractiveMode(agentConfig: AgentConfig, sessionManager: SessionManager): Promise<void> {
	const sessionData = sessionManager.getSessionData();
	if (sessionData) {
		console.log(chalk.dim(`Resuming session with ${sessionData.events.length} events`));
	}
	const renderer = new TuiRenderer();

	// Initialize TUI BEFORE creating the agent to prevent double init
	await renderer.init();

	const agent = new Agent(agentConfig, renderer, sessionManager);
	renderer.setInterruptCallback(() => {
		agent.interrupt();
	});

	if (sessionData) {
		agent.setEvents(sessionData ? sessionData.events.map((e) => e.event) : []);
		for (const sessionEvent of sessionData.events) {
			const event = sessionEvent.event;
			if (event.type === "assistant_start") {
				renderer.renderAssistantLabel();
			} else {
				await renderer.on(event);
			}
		}
	}

	while (true) {
		const userInput = await renderer.getUserInput();
		try {
			await agent.ask(userInput);
		} catch (e: any) {
			await renderer.on({ type: "error", message: e.message });
		}
	}
}

async function runSingleShotMode(
	agentConfig: AgentConfig,
	sessionManager: SessionManager,
	messages: string[],
	jsonOutput: boolean,
): Promise<void> {
	const sessionData = sessionManager.getSessionData();
	const renderer = jsonOutput ? new JsonRenderer() : new ConsoleRenderer();
	const agent = new Agent(agentConfig, renderer, sessionManager);
	if (sessionData) {
		if (!jsonOutput) {
			console.log(chalk.dim(`Resuming session with ${sessionData.events.length} events`));
		}
		agent.setEvents(sessionData ? sessionData.events.map((e) => e.event) : []);
	}

	for (const msg of messages) {
		try {
			await agent.ask(msg);
		} catch (e: any) {
			await renderer.on({ type: "error", message: e.message });
		}
	}
}

// Main function to use Agent as standalone CLI
export async function main(args: string[]): Promise<void> {
	// Parse arguments
	const parsed = parseArgs(argDefs, args);

	// Show help if requested
	if (parsed.help) {
		printHelp();
		return;
	}

	// Extract configuration from parsed args
	const baseURL = parsed["base-url"];
	const apiKey = parsed["api-key"];
	const model = parsed.model;
	const continueSession = parsed.continue;
	const api = parsed.api as "completions" | "responses";
	const systemPrompt = parsed["system-prompt"];
	const jsonOutput = parsed.json;
	const messages = parsed._; // Positional arguments

	if (!apiKey) {
		throw new Error("API key required (use --api-key or set OPENAI_API_KEY)");
	}

	// Determine mode: interactive if no messages provided
	const isInteractive = messages.length === 0;

	// Create session manager
	const sessionManager = new SessionManager(continueSession);

	// Create or restore agent
	let agentConfig: AgentConfig = {
		apiKey,
		baseURL,
		model,
		api,
		systemPrompt,
	};

	if (continueSession) {
		const sessionData = sessionManager.getSessionData();
		if (sessionData) {
			agentConfig = {
				...sessionData.config,
				apiKey, // Allow overriding API key
			};
		}
	}

	// Run in appropriate mode
	if (isInteractive) {
		if (jsonOutput) {
			await runJsonInteractiveMode(agentConfig, sessionManager);
		} else {
			await runTuiInteractiveMode(agentConfig, sessionManager);
		}
	} else {
		await runSingleShotMode(agentConfig, sessionManager, messages, jsonOutput);
	}
}

// Run as CLI if invoked directly
// Run main function when executed directly
main(process.argv.slice(2)).catch((err) => {
	console.error(err);
	process.exit(1);
});
