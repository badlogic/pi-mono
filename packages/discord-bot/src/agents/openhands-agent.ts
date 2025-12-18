/**
 * OpenHands Advanced Software Agent Integration
 * Expert-level agents with Z.ai GLM model
 *
 * Features:
 * - Expert modes: vulnerability scan, code review, test generation, documentation
 * - Security analyzer with action validation
 * - Session persistence for resumable tasks
 * - Sub-agent delegation for complex workflows
 * - Agent Experts: Act-Learn-Reuse pattern with expertise accumulation
 */

import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * SECURITY: Escape string for safe Python string embedding
 * Prevents command injection by properly escaping all special characters
 */
function escapePythonString(str: string): string {
	return str
		.replace(/\\/g, "\\\\") // Escape backslashes first
		.replace(/"/g, '\\"') // Escape double quotes
		.replace(/'/g, "\\'") // Escape single quotes
		.replace(/\n/g, "\\n") // Escape newlines
		.replace(/\r/g, "\\r") // Escape carriage returns
		.replace(/\t/g, "\\t") // Escape tabs
		.replace(/\0/g, ""); // Remove null bytes
}

// Get package root to find src files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", "..");

/**
 * Expert modes available for OpenHands agents
 */
export type OpenHandsMode =
	| "developer" // General development tasks
	| "vulnerability_scan" // Security vulnerability scanning
	| "code_review" // Thorough code review
	| "test_generation" // Comprehensive test generation
	| "documentation" // Documentation generation
	| "refactor" // Code refactoring
	| "debug" // Debugging and issue fixing
	| "migrate" // Dependency/code migration
	| "optimize" // Performance optimization
	| "trading_analysis" // Crypto trading analysis and signals
	| "strategy_backtest" // Trading strategy backtesting
	| "risk_assessment"; // Trading risk and portfolio analysis

/**
 * Result from OpenHands agent execution
 */
export interface OpenHandsResult {
	success: boolean;
	output: string;
	error: string | null;
	workspace: string;
	mode: OpenHandsMode;
	tools_used: string[];
	duration: number;
	session_id?: string;
	resumed_from?: string;
	blocked_actions?: Array<{ action: string; reason: string }>;
	delegated_tasks?: Array<{ specialty: string; success: boolean; output: string }>;
	// Agent Experts pattern
	expertise_applied?: boolean;
	learnings_captured?: boolean;
}

/**
 * Options for OpenHands agent execution
 */
export interface OpenHandsOptions {
	task: string;
	workspace?: string;
	mode?: OpenHandsMode;
	timeout?: number; // seconds
	persist?: boolean; // Enable session persistence
	sessionId?: string; // Session ID for resumption
	delegate?: boolean; // Enable sub-agent delegation
	securityCheck?: boolean; // Enable security validation (default: true)
	enableLearning?: boolean; // Enable Agent Experts learning (default: true)
}

const PYTHON_PATH = "/usr/bin/python3.12";
const SCRIPT_PATH = join(PACKAGE_ROOT, "src", "agents", "openhands-runner.py");
const DOCKER_IMAGE = "ghcr.io/all-hands-ai/openhands:main";

/**
 * Run an OpenHands software agent with expert mode support
 * Supports multiple backends: Python SDK, Docker, or API fallback
 */
export async function runOpenHandsAgent(options: OpenHandsOptions): Promise<OpenHandsResult> {
	const startTime = Date.now();
	const {
		task,
		workspace,
		mode = "developer",
		timeout = 300,
		persist = false,
		sessionId,
		delegate = false,
		securityCheck = true,
		enableLearning = true,
	} = options;

	// Check available method
	const status = await isOpenHandsAvailable();

	if (status.method === "python") {
		return runWithPython(options, startTime);
	} else if (status.method === "docker") {
		return runWithDocker(options, startTime);
	} else {
		// API fallback using OpenRouter
		return runWithAPI(options, startTime);
	}
}

/**
 * Run with Python SDK
 */
async function runWithPython(options: OpenHandsOptions, startTime: number): Promise<OpenHandsResult> {
	const {
		task,
		workspace,
		mode = "developer",
		timeout = 300,
		persist,
		sessionId,
		delegate,
		securityCheck = true,
		enableLearning = true,
	} = options;

	return new Promise((resolve) => {
		const args = [SCRIPT_PATH, task];
		if (workspace) args.push("--workspace", workspace);
		args.push("--mode", mode);
		args.push("--timeout", timeout.toString());
		if (persist) args.push("--persist");
		if (sessionId) args.push("--session-id", sessionId);
		if (delegate) args.push("--delegate");
		if (!securityCheck) args.push("--no-security");
		if (!enableLearning) args.push("--no-learning");

		let stdout = "";
		let stderr = "";

		const proc = spawn(PYTHON_PATH, args, {
			env: { ...process.env },
			timeout: timeout * 1000 + 10000,
		});

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			const duration = Date.now() - startTime;
			try {
				const marker = "###OPENHANDS_RESULT###";
				const idx = stdout.indexOf(marker);
				const jsonStr = idx !== -1 ? stdout.slice(idx + marker.length).trim() : stdout;
				const result = JSON.parse(jsonStr);
				resolve({ ...result, duration });
			} catch {
				resolve({
					success: false,
					output: stdout || stderr,
					error: code !== 0 ? `Process exited with code ${code}` : null,
					workspace: workspace || process.cwd(),
					mode,
					tools_used: [],
					duration,
				});
			}
		});

		proc.on("error", (err) => {
			resolve({
				success: false,
				output: "",
				error: err.message,
				workspace: workspace || process.cwd(),
				mode,
				tools_used: [],
				duration: Date.now() - startTime,
			});
		});
	});
}

/**
 * Run with Docker container
 */
async function runWithDocker(options: OpenHandsOptions, startTime: number): Promise<OpenHandsResult> {
	const { task, workspace, mode = "developer", timeout = 300 } = options;

	// SECURITY: Properly escape all user inputs to prevent command injection
	const safeTask = escapePythonString(task);
	const safeMode = escapePythonString(mode);
	const safeWorkspace = escapePythonString(workspace || "/app/workspace");

	return new Promise((resolve) => {
		const args = [
			"exec",
			"pi-openhands",
			"python",
			"-c",
			`
import json
try:
    from openhands import OpenHands
    agent = OpenHands()
    result = agent.run("${safeTask}")
    print("###OPENHANDS_RESULT###")
    print(json.dumps({"success": True, "output": str(result), "mode": "${safeMode}", "tools_used": [], "workspace": "${safeWorkspace}"}))
except Exception as e:
    print("###OPENHANDS_RESULT###")
    print(json.dumps({"success": False, "output": "", "error": str(e), "mode": "${safeMode}", "tools_used": [], "workspace": "${safeWorkspace}"}))
`,
		];

		let stdout = "";
		let stderr = "";

		const proc = spawn("docker", args, { timeout: timeout * 1000 + 10000 });
		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			const duration = Date.now() - startTime;
			try {
				const marker = "###OPENHANDS_RESULT###";
				const idx = stdout.indexOf(marker);
				const jsonStr = idx !== -1 ? stdout.slice(idx + marker.length).trim() : stdout;
				const result = JSON.parse(jsonStr);
				resolve({ ...result, duration });
			} catch {
				resolve({
					success: false,
					output: stdout || stderr,
					error: code !== 0 ? `Docker exec failed with code ${code}` : null,
					workspace: workspace || process.cwd(),
					mode,
					tools_used: [],
					duration,
				});
			}
		});

		proc.on("error", (err) => {
			resolve({
				success: false,
				output: "",
				error: `Docker error: ${err.message}`,
				workspace: workspace || process.cwd(),
				mode,
				tools_used: [],
				duration: Date.now() - startTime,
			});
		});
	});
}

/**
 * Run with API fallback (OpenRouter/Claude as OpenHands-like agent)
 */
async function runWithAPI(options: OpenHandsOptions, startTime: number): Promise<OpenHandsResult> {
	const { task, workspace, mode = "developer", timeout = 300 } = options;

	const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
	if (!OPENROUTER_API_KEY) {
		return {
			success: false,
			output: "",
			error: "No API key available for OpenHands fallback",
			workspace: workspace || process.cwd(),
			mode,
			tools_used: [],
			duration: Date.now() - startTime,
		};
	}

	const modePrompts: Record<string, string> = {
		developer: "You are an expert software developer. Complete the following task thoroughly.",
		vulnerability_scan:
			"You are a security expert. Scan for vulnerabilities including OWASP Top 10, hardcoded secrets, insecure dependencies.",
		code_review:
			"You are a senior code reviewer. Analyze code quality, performance, error handling, and best practices.",
		test_generation:
			"You are a testing expert. Generate comprehensive tests including unit, integration, and edge cases.",
		documentation: "You are a technical writer. Generate clear, comprehensive documentation.",
		refactor: "You are a refactoring expert. Improve code quality, reduce complexity, apply design patterns.",
		debug: "You are a debugging expert. Perform systematic debugging with root cause analysis.",
		migrate: "You are a migration expert. Handle upgrades and breaking changes carefully.",
		optimize: "You are a performance expert. Profile and optimize bottlenecks.",
	};

	try {
		const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${OPENROUTER_API_KEY}`,
			},
			body: JSON.stringify({
				model: "anthropic/claude-3.5-sonnet",
				messages: [
					{ role: "system", content: modePrompts[mode] || modePrompts.developer },
					{ role: "user", content: `Workspace: ${workspace || "current directory"}\n\nTask: ${task}` },
				],
				max_tokens: 4000,
			}),
			signal: AbortSignal.timeout(timeout * 1000),
		});

		const result = await response.json();
		const output = result.choices?.[0]?.message?.content || "No response";

		return {
			success: true,
			output,
			error: null,
			workspace: workspace || process.cwd(),
			mode,
			tools_used: ["api_fallback"],
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: error instanceof Error ? error.message : "API request failed",
			workspace: workspace || process.cwd(),
			mode,
			tools_used: [],
			duration: Date.now() - startTime,
		};
	}
}

/**
 * Available OpenHands tools
 */
export const OpenHandsTools = {
	TERMINAL: "terminal",
	FILE_EDITOR: "file_editor",
	TASK_TRACKER: "task_tracker",
	WEB: "web",
} as const;

/**
 * Expert preset configurations for common tasks
 */
export const OpenHandsPresets = {
	/**
	 * Code development agent with full toolset
	 */
	developer: (task: string, workspace?: string): OpenHandsOptions => ({
		task,
		workspace,
		mode: "developer",
		timeout: 600,
		securityCheck: true,
	}),

	/**
	 * Quick task agent with shorter timeout
	 */
	quick: (task: string, workspace?: string): OpenHandsOptions => ({
		task,
		workspace,
		mode: "developer",
		timeout: 120,
		securityCheck: true,
	}),

	/**
	 * File editing focused agent
	 */
	editor: (task: string, workspace?: string): OpenHandsOptions => ({
		task,
		workspace,
		mode: "developer",
		timeout: 300,
		securityCheck: true,
	}),

	// =========================================================================
	// Expert Mode Presets
	// =========================================================================

	/**
	 * Security vulnerability scanner
	 * Scans for OWASP Top 10, hardcoded secrets, insecure dependencies
	 */
	vulnerabilityScan: (path: string, timeout = 600): OpenHandsOptions => ({
		task: `Perform comprehensive security audit of: ${path}`,
		workspace: path,
		mode: "vulnerability_scan",
		timeout,
		securityCheck: true,
	}),

	/**
	 * Thorough code review
	 * Analyzes code quality, performance, error handling, best practices
	 */
	codeReview: (path: string, focus?: string, timeout = 300): OpenHandsOptions => ({
		task: focus ? `Review code at ${path}, focusing on: ${focus}` : `Review code at: ${path}`,
		workspace: path,
		mode: "code_review",
		timeout,
		securityCheck: true,
	}),

	/**
	 * Comprehensive test generation
	 * Creates unit tests, integration tests, edge cases
	 */
	testGeneration: (path: string, coverageTarget = 90, timeout = 600): OpenHandsOptions => ({
		task: `Generate tests for ${path} targeting ${coverageTarget}% coverage`,
		workspace: path,
		mode: "test_generation",
		timeout,
		securityCheck: true,
	}),

	/**
	 * Documentation generator
	 * Creates README, API docs, architecture diagrams
	 */
	documentation: (path: string, docType = "all", timeout = 300): OpenHandsOptions => ({
		task: `Generate ${docType} documentation for: ${path}`,
		workspace: path,
		mode: "documentation",
		timeout,
		securityCheck: true,
	}),

	/**
	 * Code refactoring
	 * Improves code quality, reduces complexity, applies patterns
	 */
	refactor: (path: string, target?: string, timeout = 600): OpenHandsOptions => ({
		task: target ? `Refactor ${path}, focusing on: ${target}` : `Refactor code at: ${path}`,
		workspace: path,
		mode: "refactor",
		timeout,
		securityCheck: true,
	}),

	/**
	 * Debug and fix issues
	 * Systematic debugging with root cause analysis
	 */
	debug: (path: string, issue: string, timeout = 300): OpenHandsOptions => ({
		task: `Debug and fix in ${path}: ${issue}`,
		workspace: path,
		mode: "debug",
		timeout,
		securityCheck: true,
	}),

	/**
	 * Dependency/code migration
	 * Handles upgrades with breaking change analysis
	 */
	migrate: (path: string, target: string, timeout = 600): OpenHandsOptions => ({
		task: `Migrate ${path} to: ${target}`,
		workspace: path,
		mode: "migrate",
		timeout,
		securityCheck: true,
	}),

	/**
	 * Performance optimization
	 * Profiles and optimizes bottlenecks
	 */
	optimize: (path: string, focus?: string, timeout = 600): OpenHandsOptions => ({
		task: focus ? `Optimize ${path}, focusing on: ${focus}` : `Optimize performance of: ${path}`,
		workspace: path,
		mode: "optimize",
		timeout,
		securityCheck: true,
	}),

	// =========================================================================
	// Advanced Presets with Special Features
	// =========================================================================

	/**
	 * Persistent session for long-running tasks
	 * Can be resumed if interrupted
	 */
	persistent: (task: string, workspace?: string, sessionId?: string): OpenHandsOptions => ({
		task,
		workspace,
		mode: "developer",
		timeout: 1800, // 30 minutes
		persist: true,
		sessionId,
		securityCheck: true,
	}),

	/**
	 * Multi-agent workflow with delegation
	 * Uses sub-agents for specialized tasks
	 */
	multiAgent: (task: string, workspace?: string): OpenHandsOptions => ({
		task,
		workspace,
		mode: "developer",
		timeout: 900, // 15 minutes
		delegate: true,
		securityCheck: true,
	}),

	/**
	 * Full project audit
	 * Combines security, code review, and documentation
	 */
	fullAudit: (path: string): OpenHandsOptions => ({
		task: `Perform full project audit: security scan, code review, and documentation check for ${path}`,
		workspace: path,
		mode: "code_review",
		timeout: 1200, // 20 minutes
		delegate: true,
		securityCheck: true,
	}),

	// =========================================================================
	// Trading Expert Presets (Moon Dev Inspired)
	// =========================================================================

	/**
	 * Crypto trading analysis
	 * Analyzes price action, technical indicators, sentiment
	 */
	tradingAnalysis: (symbol: string, priceData?: string, sentiment?: string): OpenHandsOptions => ({
		task: `Analyze ${symbol} for trading signals.${priceData ? ` Price data: ${priceData}` : ""}${sentiment ? ` Sentiment: ${sentiment}` : ""} Provide: 1) Technical analysis (RSI, MACD, support/resistance), 2) Signal recommendation (BUY/SELL/HOLD), 3) Confidence level and reasoning.`,
		mode: "trading_analysis",
		timeout: 300,
		securityCheck: false, // No code execution needed
		enableLearning: true,
	}),

	/**
	 * Trading strategy backtesting
	 * Tests strategy on historical data
	 */
	strategyBacktest: (strategy: string, params?: string, timeframe = "1 year"): OpenHandsOptions => ({
		task: `Backtest ${strategy} strategy${params ? ` with params: ${params}` : ""} over ${timeframe}. Analyze: 1) Win rate and profit factor, 2) Maximum drawdown, 3) Sharpe/Sortino ratios, 4) Monte Carlo simulation for robustness, 5) Recommended parameter adjustments.`,
		mode: "strategy_backtest",
		timeout: 600,
		securityCheck: false,
		enableLearning: true,
	}),

	/**
	 * Portfolio risk assessment
	 * Analyzes risk metrics and position sizing
	 */
	riskAssessment: (holdings: string, totalValue?: number): OpenHandsOptions => ({
		task: `Assess portfolio risk for: ${holdings}${totalValue ? ` Total value: $${totalValue}` : ""}. Calculate: 1) Value at Risk (VaR) at 95% and 99%, 2) Correlation matrix, 3) Concentration risk, 4) Optimal position sizing (Kelly Criterion), 5) Risk mitigation recommendations.`,
		mode: "risk_assessment",
		timeout: 300,
		securityCheck: false,
		enableLearning: true,
	}),

	/**
	 * Full trading audit
	 * Combines analysis, backtest, and risk assessment
	 */
	fullTradingAudit: (symbol: string, strategy?: string): OpenHandsOptions => ({
		task: `Perform full trading audit for ${symbol}${strategy ? ` using ${strategy} strategy` : ""}. Include: 1) Technical and sentiment analysis, 2) Strategy backtesting, 3) Risk assessment, 4) Final recommendation with entry/exit levels and position size.`,
		mode: "trading_analysis",
		timeout: 900,
		delegate: true,
		securityCheck: false,
		enableLearning: true,
	}),
};

/**
 * Mode descriptions for user interface
 */
export const OpenHandsModeDescriptions: Record<OpenHandsMode, string> = {
	developer: "General development - coding, debugging, file operations",
	vulnerability_scan: "Security scanning - OWASP Top 10, secrets, dependencies",
	code_review: "Code review - quality, performance, best practices",
	test_generation: "Test generation - unit, integration, edge cases",
	documentation: "Documentation - README, API docs, architecture",
	refactor: "Refactoring - complexity reduction, patterns, DRY",
	debug: "Debugging - root cause analysis, fixes, regression tests",
	migrate: "Migration - dependency upgrades, breaking changes",
	optimize: "Optimization - performance profiling, bottlenecks",
	trading_analysis: "Trading analysis - crypto signals, technical indicators, sentiment",
	strategy_backtest: "Strategy backtesting - historical performance, Monte Carlo, risk metrics",
	risk_assessment: "Risk assessment - portfolio VaR, correlation, position sizing",
};

/**
 * Check if OpenHands is available (Python SDK or Docker)
 */
export async function isOpenHandsAvailable(): Promise<{
	available: boolean;
	method: "python" | "docker" | "api" | "none";
}> {
	// Check 1: Python SDK
	const pythonAvailable = await new Promise<boolean>((resolve) => {
		const proc = spawn(PYTHON_PATH, ["-c", "import openhands; print('ok')"], { timeout: 5000 });
		let output = "";
		proc.stdout.on("data", (data) => {
			output += data.toString();
		});
		proc.on("close", (code) => resolve(code === 0 && output.includes("ok")));
		proc.on("error", () => resolve(false));
	});

	if (pythonAvailable) {
		return { available: true, method: "python" };
	}

	// Check 2: Docker container
	const dockerAvailable = await new Promise<boolean>((resolve) => {
		const proc = spawn("docker", ["ps", "--filter", "name=pi-openhands", "--format", "{{.Names}}"], {
			timeout: 5000,
		});
		let output = "";
		proc.stdout.on("data", (data) => {
			output += data.toString();
		});
		proc.on("close", () => resolve(output.includes("pi-openhands")));
		proc.on("error", () => resolve(false));
	});

	if (dockerAvailable) {
		return { available: true, method: "docker" };
	}

	// Check 3: Can start Docker?
	const canStartDocker = await new Promise<boolean>((resolve) => {
		const proc = spawn("docker", ["images", "ghcr.io/all-hands-ai/openhands", "--format", "{{.Repository}}"], {
			timeout: 5000,
		});
		let output = "";
		proc.stdout.on("data", (data) => {
			output += data.toString();
		});
		proc.on("close", () => resolve(output.includes("openhands")));
		proc.on("error", () => resolve(false));
	});

	if (canStartDocker) {
		return { available: true, method: "docker" };
	}

	// Fallback: Use API simulation (Claude Code as OpenHands-like agent)
	return { available: true, method: "api" };
}

/**
 * Simple check if OpenHands is ready
 */
export async function isOpenHandsReady(): Promise<boolean> {
	const status = await isOpenHandsAvailable();
	return status.available;
}

/**
 * Get available modes with descriptions
 */
export function getOpenHandsModes(): Array<{ mode: OpenHandsMode; description: string }> {
	return Object.entries(OpenHandsModeDescriptions).map(([mode, description]) => ({
		mode: mode as OpenHandsMode,
		description,
	}));
}

/**
 * Convenience function for running expert scans
 */
export async function runSecurityScan(path: string): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.vulnerabilityScan(path));
}

export async function runCodeReview(path: string, focus?: string): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.codeReview(path, focus));
}

export async function runTestGeneration(path: string, coverage = 90): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.testGeneration(path, coverage));
}

export async function runDocGeneration(path: string, type = "all"): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.documentation(path, type));
}

export async function runRefactor(path: string, target?: string): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.refactor(path, target));
}

export async function runDebug(path: string, issue: string): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.debug(path, issue));
}

export async function runOptimize(path: string, focus?: string): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.optimize(path, focus));
}

// ============================================================================
// Trading Expert Functions (Moon Dev Inspired)
// ============================================================================

/**
 * Run crypto trading analysis with OpenHands
 */
export async function runTradingAnalysis(
	symbol: string,
	priceData?: string,
	sentiment?: string,
): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.tradingAnalysis(symbol, priceData, sentiment));
}

/**
 * Run strategy backtesting with OpenHands
 */
export async function runStrategyBacktest(
	strategy: string,
	params?: string,
	timeframe = "1 year",
): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.strategyBacktest(strategy, params, timeframe));
}

/**
 * Run portfolio risk assessment with OpenHands
 */
export async function runRiskAssessment(holdings: string, totalValue?: number): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.riskAssessment(holdings, totalValue));
}

/**
 * Run full trading audit with OpenHands
 */
export async function runFullTradingAudit(symbol: string, strategy?: string): Promise<OpenHandsResult> {
	return runOpenHandsAgent(OpenHandsPresets.fullTradingAudit(symbol, strategy));
}

// ============================================================================
// Expertise Management (Agent Experts Pattern)
// ============================================================================

import { existsSync, readFileSync, writeFileSync } from "fs";

const EXPERTISE_DIR = join(PACKAGE_ROOT, "src", "agents", "expertise");

export interface ExpertiseStats {
	mode: string;
	sessions: number;
	size: number;
	lastUpdated: string | null;
}

/**
 * Get statistics for all expertise files
 */
export function getExpertiseStats(): ExpertiseStats[] {
	const modes = [
		"developer",
		"vulnerability_scan",
		"code_review",
		"test_generation",
		"documentation",
		"refactor",
		"debug",
		"migrate",
		"optimize",
		"trading_analysis",
		"strategy_backtest",
		"risk_assessment",
	];

	return modes.map((mode) => {
		const filePath = join(EXPERTISE_DIR, `${mode}.md`);
		if (!existsSync(filePath)) {
			return { mode, sessions: 0, size: 0, lastUpdated: null };
		}

		const content = readFileSync(filePath, "utf-8");
		const sessions = (content.match(/### Session:/g) || []).length;
		const lastUpdatedMatch = content.match(/\*Last updated: ([^*]+)\*/);

		return {
			mode,
			sessions,
			size: content.length,
			lastUpdated: lastUpdatedMatch ? lastUpdatedMatch[1].trim() : null,
		};
	});
}

/**
 * Get expertise content for a specific mode
 */
export function getExpertiseContent(mode: OpenHandsMode): string | null {
	const filePath = join(EXPERTISE_DIR, `${mode}.md`);
	if (!existsSync(filePath)) {
		return null;
	}
	return readFileSync(filePath, "utf-8");
}

/**
 * Clear expertise for a mode (reset to template)
 */
export function clearExpertise(mode: OpenHandsMode): boolean {
	const filePath = join(EXPERTISE_DIR, `${mode}.md`);
	if (!existsSync(filePath)) {
		return false;
	}

	const templates: Record<string, string> = {
		developer: `# Developer Expert

## Mental Model
Accumulated expertise for general development tasks.

## Patterns Learned
<!-- Agent updates this section with successful patterns -->

## Common Pitfalls
<!-- Agent updates this section with mistakes to avoid -->

## Effective Approaches
<!-- Agent updates this section with approaches that worked well -->

## Code Templates
<!-- Agent stores reusable code patterns here -->

## Session Insights
<!-- Recent session learnings -->

---
*Last updated: Never*
*Total sessions: 0*
`,
	};

	// Use generic template if specific not found
	const template =
		templates[mode] ||
		`# ${mode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Expert

## Mental Model
Accumulated expertise for ${mode.replace(/_/g, " ")} tasks.

## Session Insights
<!-- Recent session learnings -->

---
*Last updated: Never*
*Total sessions: 0*
`;

	writeFileSync(filePath, template);
	return true;
}
