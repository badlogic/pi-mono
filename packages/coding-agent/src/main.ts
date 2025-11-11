import { Agent, ProviderTransport, type ThinkingLevel } from "@mariozechner/pi-agent";
import { getModel } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { SessionManager } from "./session-manager.js";
import { codingTools } from "./tools/index.js";
import { TuiRenderer } from "./tui/tui-renderer.js";

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
const VERSION = packageJson.version;

interface Args {
	provider?: string;
	model?: string;
	apiKey?: string;
	systemPrompt?: string;
	continue?: boolean;
	help?: boolean;
	messages: string[];
}

function parseArgs(args: string[]): Args {
	const result: Args = {
		messages: [],
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--continue" || arg === "-c") {
			result.continue = true;
		} else if (arg === "--provider" && i + 1 < args.length) {
			result.provider = args[++i];
		} else if (arg === "--model" && i + 1 < args.length) {
			result.model = args[++i];
		} else if (arg === "--api-key" && i + 1 < args.length) {
			result.apiKey = args[++i];
		} else if (arg === "--system-prompt" && i + 1 < args.length) {
			result.systemPrompt = args[++i];
		} else if (!arg.startsWith("-")) {
			result.messages.push(arg);
		}
	}

	return result;
}

function printHelp() {
	console.log(`${chalk.bold("coding-agent")} - AI coding assistant with read, bash, edit, write tools

${chalk.bold("Usage:")}
  coding-agent [options] [messages...]

${chalk.bold("Options:")}
  --provider <name>       Provider name (default: google)
  --model <id>            Model ID (default: gemini-2.5-flash)
  --api-key <key>         API key (defaults to env vars)
  --system-prompt <text>  System prompt (default: coding assistant prompt)
  --continue, -c          Continue previous session
  --help, -h              Show this help

${chalk.bold("Examples:")}
  # Interactive mode (no messages = interactive TUI)
  coding-agent

  # Single message
  coding-agent "List all .ts files in src/"

  # Multiple messages
  coding-agent "Read package.json" "What dependencies do we have?"

  # Continue previous session
  coding-agent --continue "What did we discuss?"

  # Use different model
  coding-agent --provider openai --model gpt-4o-mini "Help me refactor this code"

${chalk.bold("Environment Variables:")}
  GEMINI_API_KEY       - Google Gemini API key
  OPENAI_API_KEY       - OpenAI API key
  ANTHROPIC_API_KEY    - Anthropic API key
  CODING_AGENT_DIR     - Session storage directory (default: ~/.coding-agent)

${chalk.bold("Available Tools:")}
  read   - Read file contents
  bash   - Execute bash commands
  edit   - Edit files with find/replace
  write  - Write files (creates/overwrites)
`);
}

const DEFAULT_SYSTEM_PROMPT = `You are an expert coding assistant. You help users with coding tasks by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make surgical edits to files (find exact text and replace)
- write: Create or overwrite files

Guidelines:
- Always use bash tool for file operations like ls, grep, find
- Use read to examine files before editing
- Use edit for precise changes (old text must match exactly)
- Use write only for new files or complete rewrites
- Be concise in your responses
- Show file paths clearly when working with files

Current directory: ${process.cwd()}`;

async function runInteractiveMode(agent: Agent, sessionManager: SessionManager, version: string): Promise<void> {
	const renderer = new TuiRenderer(agent, sessionManager, version);

	// Initialize TUI
	await renderer.init();

	// Set interrupt callback
	renderer.setInterruptCallback(() => {
		agent.abort();
	});

	// Render any existing messages (from --continue mode)
	renderer.renderInitialMessages(agent.state);

	// Subscribe to agent events
	agent.subscribe(async (event) => {
		// Pass all events to the renderer
		await renderer.handleEvent(event, agent.state);
	});

	// Interactive loop
	while (true) {
		const userInput = await renderer.getUserInput();

		// Process the message - agent.prompt will add user message and trigger state updates
		try {
			await agent.prompt(userInput);
		} catch (error: any) {
			// Error handling - errors should be in agent state
			console.error("Error:", error.message);
		}
	}
}

async function runSingleShotMode(agent: Agent, sessionManager: SessionManager, messages: string[]): Promise<void> {
	for (const message of messages) {
		console.log(chalk.blue(`\n> ${message}\n`));
		await agent.prompt(message);

		// Print response
		const lastMessage = agent.state.messages[agent.state.messages.length - 1];
		if (lastMessage.role === "assistant") {
			for (const content of lastMessage.content) {
				if (content.type === "text") {
					console.log(content.text);
				}
			}
		}
	}

	console.log(chalk.dim(`\nSession saved to: ${sessionManager.getSessionFile()}`));
}

export async function main(args: string[]) {
	const parsed = parseArgs(args);

	if (parsed.help) {
		printHelp();
		return;
	}

	// Setup session manager
	const sessionManager = new SessionManager(parsed.continue);

	// Determine provider and model
	const provider = (parsed.provider || "anthropic") as any;
	const modelId = parsed.model || "claude-sonnet-4-5";

	// Get API key
	let apiKey = parsed.apiKey;
	if (!apiKey) {
		const envVarMap: Record<string, string> = {
			google: "GEMINI_API_KEY",
			openai: "OPENAI_API_KEY",
			anthropic: "ANTHROPIC_OAUTH_TOKEN",
			xai: "XAI_API_KEY",
			groq: "GROQ_API_KEY",
			cerebras: "CEREBRAS_API_KEY",
			zai: "ZAI_API_KEY",
		};
		const envVar = envVarMap[provider] || `${provider.toUpperCase()}_API_KEY`;
		apiKey = process.env[envVar];

		if (!apiKey) {
			console.error(chalk.red(`Error: No API key found for provider "${provider}"`));
			console.error(chalk.dim(`Set ${envVar} environment variable or use --api-key flag`));
			process.exit(1);
		}
	}

	// Create agent
	const model = getModel(provider, modelId);
	const systemPrompt = parsed.systemPrompt || DEFAULT_SYSTEM_PROMPT;

	const agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel: "off",
			tools: codingTools,
		},
		transport: new ProviderTransport({
			getApiKey: async () => apiKey!,
		}),
	});

	// Load previous messages if continuing
	if (parsed.continue) {
		const messages = sessionManager.loadMessages();
		if (messages.length > 0) {
			console.log(chalk.dim(`Loaded ${messages.length} messages from previous session`));
			agent.replaceMessages(messages);
		}

		// Load and restore thinking level
		const thinkingLevel = sessionManager.loadThinkingLevel() as ThinkingLevel;
		if (thinkingLevel) {
			agent.setThinkingLevel(thinkingLevel);
			console.log(chalk.dim(`Restored thinking level: ${thinkingLevel}`));
		}
	}

	// Start session
	sessionManager.startSession(agent.state);

	// Subscribe to agent events to save messages and log events
	agent.subscribe((event) => {
		// Save messages on completion
		if (event.type === "message_end") {
			sessionManager.saveMessage(event.message);
		}

		// Log all events
		sessionManager.saveEvent(event);
	});

	// Determine mode: interactive if no messages provided
	const isInteractive = parsed.messages.length === 0;

	if (isInteractive) {
		await runInteractiveMode(agent, sessionManager, VERSION);
	} else {
		await runSingleShotMode(agent, sessionManager, parsed.messages);
	}
}
