import { Agent, ProviderTransport, type ThinkingLevel } from "@mariozechner/pi-agent";
import { getModel, type KnownProvider } from "@mariozechner/pi-ai";
import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { getChangelogPath, getNewEntries, parseChangelog } from "./changelog.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";
import { codingTools } from "./tools/index.js";
import { SessionSelectorComponent } from "./tui/session-selector.js";
import { TuiRenderer } from "./tui/tui-renderer.js";

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
const VERSION = packageJson.version;

const envApiKeyMap: Record<KnownProvider, string[]> = {
	google: ["GEMINI_API_KEY"],
	openai: ["OPENAI_API_KEY"],
	anthropic: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
	xai: ["XAI_API_KEY"],
	groq: ["GROQ_API_KEY"],
	cerebras: ["CEREBRAS_API_KEY"],
	openrouter: ["OPENROUTER_API_KEY"],
	zai: ["ZAI_API_KEY"],
};

type Mode = "text" | "json" | "rpc";

interface Args {
	provider?: string;
	model?: string;
	apiKey?: string;
	systemPrompt?: string;
	continue?: boolean;
	resume?: boolean;
	help?: boolean;
	mode?: Mode;
	noSession?: boolean;
	session?: string;
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
		} else if (arg === "--mode" && i + 1 < args.length) {
			const mode = args[++i];
			if (mode === "text" || mode === "json" || mode === "rpc") {
				result.mode = mode;
			}
		} else if (arg === "--continue" || arg === "-c") {
			result.continue = true;
		} else if (arg === "--resume" || arg === "-r") {
			result.resume = true;
		} else if (arg === "--provider" && i + 1 < args.length) {
			result.provider = args[++i];
		} else if (arg === "--model" && i + 1 < args.length) {
			result.model = args[++i];
		} else if (arg === "--api-key" && i + 1 < args.length) {
			result.apiKey = args[++i];
		} else if (arg === "--system-prompt" && i + 1 < args.length) {
			result.systemPrompt = args[++i];
		} else if (arg === "--no-session") {
			result.noSession = true;
		} else if (arg === "--session" && i + 1 < args.length) {
			result.session = args[++i];
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
  --mode <mode>           Output mode: text (default), json, or rpc
  --continue, -c          Continue previous session
  --resume, -r            Select a session to resume
  --session <path>        Use specific session file
  --no-session            Don't save session (ephemeral)
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

function buildSystemPrompt(customPrompt?: string): string {
	// Check if customPrompt is a file path that exists
	if (customPrompt && existsSync(customPrompt)) {
		try {
			customPrompt = readFileSync(customPrompt, "utf-8");
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read system prompt file ${customPrompt}: ${error}`));
			// Fall through to use as literal string
		}
	}

	if (customPrompt) {
		// Use custom prompt as base, then add context/datetime
		const now = new Date();
		const dateTime = now.toLocaleString("en-US", {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			timeZoneName: "short",
		});

		let prompt = customPrompt;

		// Append project context files
		const contextFiles = loadProjectContextFiles();
		if (contextFiles.length > 0) {
			prompt += "\n\n# Project Context\n\n";
			prompt += "The following project context files have been loaded:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `## ${filePath}\n\n${content}\n\n`;
			}
		}

		// Add date/time and working directory last
		prompt += `\nCurrent date and time: ${dateTime}`;
		prompt += `\nCurrent working directory: ${process.cwd()}`;

		return prompt;
	}

	const now = new Date();
	const dateTime = now.toLocaleString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		timeZoneName: "short",
	});

	let prompt = `You are an expert coding assistant. You help users with coding tasks by reading files, executing commands, editing code, and writing new files.

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
- Show file paths clearly when working with files`;

	// Append project context files
	const contextFiles = loadProjectContextFiles();
	if (contextFiles.length > 0) {
		prompt += "\n\n# Project Context\n\n";
		prompt += "The following project context files have been loaded:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `## ${filePath}\n\n${content}\n\n`;
		}
	}

	// Add date/time and working directory last
	prompt += `\nCurrent date and time: ${dateTime}`;
	prompt += `\nCurrent working directory: ${process.cwd()}`;

	return prompt;
}

/**
 * Look for AGENTS.md or CLAUDE.md in a directory (prefers AGENTS.md)
 */
function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
	const candidates = ["AGENTS.md", "CLAUDE.md"];
	for (const filename of candidates) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				return {
					path: filePath,
					content: readFileSync(filePath, "utf-8"),
				};
			} catch (error) {
				console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
			}
		}
	}
	return null;
}

/**
 * Load all project context files in order:
 * 1. Global: ~/.pi/agent/AGENTS.md or CLAUDE.md
 * 2. Parent directories (top-most first) down to cwd
 * Each returns {path, content} for separate messages
 */
function loadProjectContextFiles(): Array<{ path: string; content: string }> {
	const contextFiles: Array<{ path: string; content: string }> = [];

	// 1. Load global context from ~/.pi/agent/
	const homeDir = homedir();
	const globalContextDir = resolve(process.env.CODING_AGENT_DIR || join(homeDir, ".pi/agent/"));
	const globalContext = loadContextFileFromDir(globalContextDir);
	if (globalContext) {
		contextFiles.push(globalContext);
	}

	// 2. Walk up from cwd to root, collecting all context files
	const cwd = process.cwd();
	const ancestorContextFiles: Array<{ path: string; content: string }> = [];

	let currentDir = cwd;
	const root = resolve("/");

	while (true) {
		const contextFile = loadContextFileFromDir(currentDir);
		if (contextFile) {
			// Add to beginning so we get top-most parent first
			ancestorContextFiles.unshift(contextFile);
		}

		// Stop if we've reached root
		if (currentDir === root) break;

		// Move up one directory
		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) break; // Safety check
		currentDir = parentDir;
	}

	// Add ancestor files in order (top-most → cwd)
	contextFiles.push(...ancestorContextFiles);

	return contextFiles;
}

async function selectSession(sessionManager: SessionManager): Promise<string | null> {
	return new Promise((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let resolved = false;

		const selector = new SessionSelectorComponent(
			sessionManager,
			(path: string) => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(path);
				}
			},
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(null);
				}
			},
		);

		ui.addChild(selector);
		ui.setFocus(selector.getSessionList());
		ui.start();
	});
}

async function runInteractiveMode(
	agent: Agent,
	sessionManager: SessionManager,
	version: string,
	changelogMarkdown: string | null = null,
): Promise<void> {
	const renderer = new TuiRenderer(agent, sessionManager, version, changelogMarkdown);

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
			// Display error in the TUI by adding an error message to the chat
			renderer.showError(error.message || "Unknown error occurred");
		}
	}
}

async function runSingleShotMode(
	agent: Agent,
	_sessionManager: SessionManager,
	messages: string[],
	mode: "text" | "json",
): Promise<void> {
	if (mode === "json") {
		// Subscribe to all events and output as JSON
		agent.subscribe((event) => {
			// Output event as JSON (same format as session manager)
			console.log(JSON.stringify(event));
		});
	}

	for (const message of messages) {
		await agent.prompt(message);
	}

	// In text mode, only output the final assistant message
	if (mode === "text") {
		const lastMessage = agent.state.messages[agent.state.messages.length - 1];
		if (lastMessage.role === "assistant") {
			for (const content of lastMessage.content) {
				if (content.type === "text") {
					console.log(content.text);
				}
			}
		}
	}
}

async function runRpcMode(agent: Agent, _sessionManager: SessionManager): Promise<void> {
	// Subscribe to all events and output as JSON
	agent.subscribe((event) => {
		console.log(JSON.stringify(event));
	});

	// Listen for JSON input on stdin
	const readline = await import("readline");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	rl.on("line", async (line: string) => {
		try {
			const input = JSON.parse(line);

			// Handle different RPC commands
			if (input.type === "prompt" && input.message) {
				await agent.prompt(input.message);
			} else if (input.type === "abort") {
				agent.abort();
			}
		} catch (error: any) {
			// Output error as JSON
			console.log(JSON.stringify({ type: "error", error: error.message }));
		}
	});

	// Keep process alive
	return new Promise(() => {});
}

export async function main(args: string[]) {
	const parsed = parseArgs(args);

	if (parsed.help) {
		printHelp();
		return;
	}

	// Setup session manager
	const sessionManager = new SessionManager(parsed.continue && !parsed.resume, parsed.session);

	// Disable session saving if --no-session flag is set
	if (parsed.noSession) {
		sessionManager.disable();
	}

	// Handle --resume flag: show session selector
	if (parsed.resume) {
		const selectedSession = await selectSession(sessionManager);
		if (!selectedSession) {
			console.log(chalk.dim("No session selected"));
			return;
		}
		// Set the selected session as the active session
		sessionManager.setSessionFile(selectedSession);
	}

	// Determine provider and model
	const provider = (parsed.provider || "anthropic") as any;
	const modelId = parsed.model || "claude-sonnet-4-5";

	// Helper function to get API key for a provider
	const getApiKeyForProvider = (providerName: string): string | undefined => {
		// Check if API key was provided via command line
		if (parsed.apiKey) {
			return parsed.apiKey;
		}

		const envVars = envApiKeyMap[providerName as KnownProvider];

		// Check each environment variable in priority order
		for (const envVar of envVars) {
			const key = process.env[envVar];
			if (key) {
				return key;
			}
		}

		return undefined;
	};

	// Get initial API key
	const initialApiKey = getApiKeyForProvider(provider);
	if (!initialApiKey) {
		const envVars = envApiKeyMap[provider as KnownProvider];
		const envVarList = envVars.join(" or ");
		console.error(chalk.red(`Error: No API key found for provider "${provider}"`));
		console.error(chalk.dim(`Set ${envVarList} environment variable or use --api-key flag`));
		process.exit(1);
	}

	// Create agent
	const model = getModel(provider, modelId);
	const systemPrompt = buildSystemPrompt(parsed.systemPrompt);

	const agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel: "off",
			tools: codingTools,
		},
		transport: new ProviderTransport({
			// Dynamic API key lookup based on current model's provider
			getApiKey: async () => {
				const currentProvider = agent.state.model.provider;
				const key = getApiKeyForProvider(currentProvider);
				if (!key) {
					throw new Error(
						`No API key found for provider "${currentProvider}". Please set the appropriate environment variable.`,
					);
				}
				return key;
			},
		}),
	});

	// Determine mode early to know if we should print messages
	const isInteractive = parsed.messages.length === 0;
	const mode = parsed.mode || "text";
	const shouldPrintMessages = isInteractive || mode === "text";

	// Load previous messages if continuing or resuming
	if (parsed.continue || parsed.resume) {
		const messages = sessionManager.loadMessages();
		if (messages.length > 0) {
			if (shouldPrintMessages) {
				console.log(chalk.dim(`Loaded ${messages.length} messages from previous session`));
			}
			agent.replaceMessages(messages);
		}

		// Load and restore model
		const savedModel = sessionManager.loadModel();
		if (savedModel) {
			// Parse provider/modelId from saved model string (format: "provider/modelId")
			// Some providers or model IDs may contain slashes, so split only on the first slash.
			// For example, "openrouter/x-ai/grok-4-fast" -> provider: "openrouter", modelId: "x-ai/grok-4-fast".
			const [savedProvider, savedModelId] = savedModel.split("/", 1);
			if (savedProvider && savedModelId) {
				try {
					const restoredModel = getModel(savedProvider as any, savedModelId);
					agent.setModel(restoredModel);
					if (shouldPrintMessages) {
						console.log(chalk.dim(`Restored model: ${savedModel}`));
					}
				} catch (error: any) {
					if (shouldPrintMessages) {
						console.error(chalk.yellow(`Warning: Could not restore model ${savedModel}: ${error.message}`));
					}
				}
			}
		}

		// Load and restore thinking level
		const thinkingLevel = sessionManager.loadThinkingLevel() as ThinkingLevel;
		if (thinkingLevel) {
			agent.setThinkingLevel(thinkingLevel);
			if (shouldPrintMessages) {
				console.log(chalk.dim(`Restored thinking level: ${thinkingLevel}`));
			}
		}
	}

	// Note: Session will be started lazily after first user+assistant message exchange
	// (unless continuing/resuming, in which case it's already initialized)

	// Log loaded context files (they're already in the system prompt)
	if (shouldPrintMessages && !parsed.continue && !parsed.resume) {
		const contextFiles = loadProjectContextFiles();
		if (contextFiles.length > 0) {
			console.log(chalk.dim("Loaded project context from:"));
			for (const { path: filePath } of contextFiles) {
				console.log(chalk.dim(`  - ${filePath}`));
			}
		}
	}

	// Subscribe to agent events to save messages
	agent.subscribe((event) => {
		// Save messages on completion
		if (event.type === "message_end") {
			sessionManager.saveMessage(event.message);

			// Check if we should initialize session now (after first user+assistant exchange)
			if (sessionManager.shouldInitializeSession(agent.state.messages)) {
				sessionManager.startSession(agent.state);
			}
		}
	});

	// Route to appropriate mode
	if (mode === "rpc") {
		// RPC mode - headless operation
		await runRpcMode(agent, sessionManager);
	} else if (isInteractive) {
		// Check if we should show changelog (only in interactive mode, only for new sessions)
		let changelogMarkdown: string | null = null;
		if (!parsed.continue && !parsed.resume) {
			const settingsManager = new SettingsManager();
			const lastVersion = settingsManager.getLastChangelogVersion();

			// Check if we need to show changelog
			if (!lastVersion) {
				// First run - show all entries
				const changelogPath = getChangelogPath();
				const entries = parseChangelog(changelogPath);
				if (entries.length > 0) {
					changelogMarkdown = entries.map((e) => e.content).join("\n\n");
					settingsManager.setLastChangelogVersion(VERSION);
				}
			} else {
				// Parse current and last versions
				const currentParts = VERSION.split(".").map(Number);
				const current = { major: currentParts[0] || 0, minor: currentParts[1] || 0, patch: currentParts[2] || 0 };
				const changelogPath = getChangelogPath();
				const entries = parseChangelog(changelogPath);
				const newEntries = getNewEntries(entries, lastVersion);

				if (newEntries.length > 0) {
					changelogMarkdown = newEntries.map((e) => e.content).join("\n\n");
					settingsManager.setLastChangelogVersion(VERSION);
				}
			}
		}

		// No messages and not RPC - use TUI
		await runInteractiveMode(agent, sessionManager, VERSION, changelogMarkdown);
	} else {
		// CLI mode with messages
		await runSingleShotMode(agent, sessionManager, parsed.messages, mode);
	}
}
