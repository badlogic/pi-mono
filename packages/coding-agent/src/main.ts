import { Agent, ProviderTransport, type ThinkingLevel } from "@mariozechner/pi-agent";
import type { Api, KnownProvider, Model } from "@mariozechner/pi-ai";
import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { getChangelogPath, getNewEntries, parseChangelog } from "./changelog.js";
import { findModel, getApiKeyForModel, getAvailableModels } from "./model-config.js";
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

const defaultModelPerProvider: Record<KnownProvider, string> = {
	anthropic: "claude-sonnet-4-5",
	openai: "gpt-5.1-codex",
	google: "gemini-2.5-pro",
	openrouter: "openai/gpt-5.1-codex",
	xai: "grok-4-fast-non-reasoning",
	groq: "openai/gpt-oss-120b",
	cerebras: "zai-glm-4.6",
	zai: "glm-4.6",
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
	thinking?: ThinkingLevel;
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
		} else if (arg === "--thinking" && i + 1 < args.length) {
			const level = args[++i];
			if (level === "off" || level === "minimal" || level === "low" || level === "medium" || level === "high") {
				result.thinking = level as ThinkingLevel;
			}
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
  --thinking <level>      Initial thinking level: off, minimal, low, medium, high (default: off)
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

	// Get absolute path to README.md
	const readmePath = resolve(join(__dirname, "../README.md"));

	let prompt = `You are actually not Claude, you are Pi. You are an expert coding assistant. You help users with coding tasks by reading files, executing commands, editing code, and writing new files.

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

Documentation:
- Your own documentation (including custom model setup) is at: ${readmePath}
- Read it when users ask about features, configuration, or setup, and especially if the user asks you to add a custom model or provider.`;

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
	settingsManager: SettingsManager,
	version: string,
	changelogMarkdown: string | null = null,
	modelFallbackMessage: string | null = null,
): Promise<void> {
	const renderer = new TuiRenderer(agent, sessionManager, settingsManager, version, changelogMarkdown);

	// Initialize TUI
	await renderer.init();

	// Set interrupt callback
	renderer.setInterruptCallback(() => {
		agent.abort();
	});

	// Render any existing messages (from --continue mode)
	renderer.renderInitialMessages(agent.state);

	// Show model fallback warning at the end of the chat if applicable
	if (modelFallbackMessage) {
		renderer.showWarning(modelFallbackMessage);
	}

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

	// Settings manager
	const settingsManager = new SettingsManager();

	// Determine initial model using priority system:
	// 1. CLI args (--provider and --model)
	// 2. Restored from session (if --continue or --resume)
	// 3. Saved default from settings.json
	// 4. First available model with valid API key
	// 5. null (allowed in interactive mode)
	let initialModel: Model<Api> | null = null;

	if (parsed.provider && parsed.model) {
		// 1. CLI args take priority
		const { model, error } = findModel(parsed.provider, parsed.model);
		if (error) {
			console.error(chalk.red(error));
			process.exit(1);
		}
		if (!model) {
			console.error(chalk.red(`Model ${parsed.provider}/${parsed.model} not found`));
			process.exit(1);
		}
		initialModel = model;
	} else if (parsed.continue || parsed.resume) {
		// 2. Restore from session (will be handled below after loading session)
		// Leave initialModel as null for now
	}

	if (!initialModel) {
		// 3. Try saved default from settings
		const defaultProvider = settingsManager.getDefaultProvider();
		const defaultModel = settingsManager.getDefaultModel();
		if (defaultProvider && defaultModel) {
			const { model, error } = findModel(defaultProvider, defaultModel);
			if (error) {
				console.error(chalk.red(error));
				process.exit(1);
			}
			initialModel = model;
		}
	}

	if (!initialModel) {
		// 4. Try first available model with valid API key
		// Prefer default model for each provider if available
		const { models: availableModels, error } = getAvailableModels();

		if (error) {
			console.error(chalk.red(error));
			process.exit(1);
		}

		if (availableModels.length > 0) {
			// Try to find a default model from known providers
			for (const provider of Object.keys(defaultModelPerProvider) as KnownProvider[]) {
				const defaultModelId = defaultModelPerProvider[provider];
				const match = availableModels.find((m) => m.provider === provider && m.id === defaultModelId);
				if (match) {
					initialModel = match;
					break;
				}
			}

			// If no default found, use first available
			if (!initialModel) {
				initialModel = availableModels[0];
			}
		}
	}

	// Determine mode early to know if we should print messages and fail early
	const isInteractive = parsed.messages.length === 0 && parsed.mode === undefined;
	const mode = parsed.mode || "text";
	const shouldPrintMessages = isInteractive || mode === "text";

	// Non-interactive mode: fail early if no model available
	if (!isInteractive && !initialModel) {
		console.error(chalk.red("No models available."));
		console.error(chalk.yellow("\nSet an API key environment variable:"));
		console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		console.error(chalk.yellow("\nOr create ~/.pi/agent/models.json"));
		process.exit(1);
	}

	// Non-interactive mode: validate API key exists
	if (!isInteractive && initialModel) {
		const apiKey = parsed.apiKey || getApiKeyForModel(initialModel);
		if (!apiKey) {
			console.error(chalk.red(`No API key found for ${initialModel.provider}`));
			process.exit(1);
		}
	}

	const systemPrompt = buildSystemPrompt(parsed.systemPrompt);

	// Load previous messages if continuing or resuming
	// This may update initialModel if restoring from session
	if (parsed.continue || parsed.resume) {
		const messages = sessionManager.loadMessages();
		if (messages.length > 0 && shouldPrintMessages) {
			console.log(chalk.dim(`Loaded ${messages.length} messages from previous session`));
		}

		// Load and restore model (overrides initialModel if found and has API key)
		const savedModel = sessionManager.loadModel();
		if (savedModel) {
			const { model: restoredModel, error } = findModel(savedModel.provider, savedModel.modelId);

			if (error) {
				console.error(chalk.red(error));
				process.exit(1);
			}

			// Check if restored model exists and has a valid API key
			const hasApiKey = restoredModel ? !!getApiKeyForModel(restoredModel) : false;

			if (restoredModel && hasApiKey) {
				initialModel = restoredModel;
				if (shouldPrintMessages) {
					console.log(chalk.dim(`Restored model: ${savedModel.provider}/${savedModel.modelId}`));
				}
			} else {
				// Model not found or no API key - fall back to default selection
				const reason = !restoredModel ? "model no longer exists" : "no API key available";

				if (shouldPrintMessages) {
					console.error(
						chalk.yellow(
							`Warning: Could not restore model ${savedModel.provider}/${savedModel.modelId} (${reason}).`,
						),
					);
				}

				// Ensure we have a valid model - use the same fallback logic
				if (!initialModel) {
					const { models: availableModels, error: availableError } = getAvailableModels();
					if (availableError) {
						console.error(chalk.red(availableError));
						process.exit(1);
					}
					if (availableModels.length > 0) {
						// Try to find a default model from known providers
						for (const provider of Object.keys(defaultModelPerProvider) as KnownProvider[]) {
							const defaultModelId = defaultModelPerProvider[provider];
							const match = availableModels.find((m) => m.provider === provider && m.id === defaultModelId);
							if (match) {
								initialModel = match;
								break;
							}
						}

						// If no default found, use first available
						if (!initialModel) {
							initialModel = availableModels[0];
						}

						if (initialModel && shouldPrintMessages) {
							console.log(chalk.dim(`Falling back to: ${initialModel.provider}/${initialModel.id}`));
						}
					} else {
						// No models available at all
						if (shouldPrintMessages) {
							console.error(chalk.red("\nNo models available."));
							console.error(chalk.yellow("Set an API key environment variable:"));
							console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
							console.error(chalk.yellow("\nOr create ~/.pi/agent/models.json"));
						}
						process.exit(1);
					}
				} else if (shouldPrintMessages) {
					console.log(chalk.dim(`Falling back to: ${initialModel.provider}/${initialModel.id}`));
				}
			}
		}
	}

	// Create agent (initialModel can be null in interactive mode)
	const agent = new Agent({
		initialState: {
			systemPrompt,
			model: initialModel as any, // Can be null
			thinkingLevel: parsed.thinking || "off",
			tools: codingTools,
		},
		transport: new ProviderTransport({
			// Dynamic API key lookup based on current model's provider
			getApiKey: async () => {
				const currentModel = agent.state.model;
				if (!currentModel) {
					throw new Error("No model selected");
				}

				// Try CLI override first
				if (parsed.apiKey) {
					return parsed.apiKey;
				}

				// Use model-specific key lookup
				const key = getApiKeyForModel(currentModel);
				if (!key) {
					throw new Error(
						`No API key found for provider "${currentModel.provider}". Please set the appropriate environment variable or update ~/.pi/agent/models.json`,
					);
				}
				return key;
			},
		}),
	});

	// Track if we had to fall back from saved model (to show in chat later)
	let modelFallbackMessage: string | null = null;

	// Load previous messages if continuing or resuming
	if (parsed.continue || parsed.resume) {
		const messages = sessionManager.loadMessages();
		if (messages.length > 0) {
			agent.replaceMessages(messages);
		}

		// Load and restore thinking level (only if CLI arg not provided)
		if (!parsed.thinking) {
			const thinkingLevel = sessionManager.loadThinkingLevel() as ThinkingLevel;
			if (thinkingLevel) {
				agent.setThinkingLevel(thinkingLevel);
				if (shouldPrintMessages) {
					console.log(chalk.dim(`Restored thinking level: ${thinkingLevel}`));
				}
			}
		}

		// Check if we had to fall back from saved model
		const savedModel = sessionManager.loadModel();
		if (savedModel && initialModel) {
			const savedMatches = initialModel.provider === savedModel.provider && initialModel.id === savedModel.modelId;
			if (!savedMatches) {
				const { model: restoredModel, error } = findModel(savedModel.provider, savedModel.modelId);
				if (error) {
					// Config error - already shown above, just use generic message
					modelFallbackMessage = `Could not restore model ${savedModel.provider}/${savedModel.modelId}. Using ${initialModel.provider}/${initialModel.id}.`;
				} else {
					const reason = !restoredModel ? "model no longer exists" : "no API key available";
					modelFallbackMessage = `Could not restore model ${savedModel.provider}/${savedModel.modelId} (${reason}). Using ${initialModel.provider}/${initialModel.id}.`;
				}
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
		await runInteractiveMode(
			agent,
			sessionManager,
			settingsManager,
			VERSION,
			changelogMarkdown,
			modelFallbackMessage,
		);
	} else {
		// CLI mode with messages
		await runSingleShotMode(agent, sessionManager, parsed.messages, mode);
	}
}
