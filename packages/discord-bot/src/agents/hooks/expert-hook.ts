/**
 * Expert Hook for Discord Bot Agent System
 *
 * Integrates the Act-Learn-Reuse pattern with the hook lifecycle.
 * Automatically detects domain expertise, injects context, and captures learnings.
 *
 * Features:
 * - Auto-detect domain from task content (security, database, trading, etc.)
 * - Inject accumulated expertise into agent context
 * - Extract and persist learnings from agent output
 * - Risk-aware domain handling (critical domains get extra validation)
 *
 * Based on TAC Lesson 13: Agent Experts
 */

import { CODEBASE_EXPERTS, detectExpertDomain, PRODUCT_EXPERTS } from "../agent-experts.js";
import {
	extractLearnings,
	getExpertisePath,
	loadExpertise,
	SELF_IMPROVE_PROMPTS,
	updateExpertise,
} from "../expertise-manager.js";
import type { AgentHookAPI, ExpertContext, ExpertHookConfig } from "./types.js";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: ExpertHookConfig = {
	enabled: true,
	autoDetect: true,
	domains: ["security", "database", "trading", "api_integration", "performance", "billing"],
	learningEnabled: true,
	maxSessionInsights: 5,
};

// ============================================================================
// Domain Detection
// ============================================================================

/**
 * Domain patterns for auto-detection
 */
const DOMAIN_PATTERNS: Record<string, RegExp[]> = {
	security: [
		/auth(?:entication|orization)?/i,
		/password|secret|token|key|credential/i,
		/encrypt|decrypt|hash|salt/i,
		/xss|csrf|sql.?injection|vulnerability/i,
		/sanitiz|escap|valid/i,
		/permission|role|access.?control/i,
	],
	database: [
		/database|db|sql|query/i,
		/migration|schema|table|column/i,
		/index|constraint|foreign.?key/i,
		/transaction|rollback|commit/i,
		/orm|prisma|sequelize|knex/i,
		/select|insert|update|delete.*from/i,
	],
	trading: [
		/trad(?:e|ing)|order|position/i,
		/market|price|ticker|symbol/i,
		/portfolio|balance|pnl/i,
		/strategy|signal|indicator/i,
		/exchange|binance|coinbase|hyperliquid/i,
		/slippage|leverage|margin/i,
	],
	api_integration: [
		/api|endpoint|rest|graphql/i,
		/webhook|callback|event/i,
		/rate.?limit|throttl/i,
		/oauth|jwt|bearer/i,
		/fetch|axios|request/i,
		/integration|third.?party/i,
	],
	performance: [
		/optimi[zs]|performance|speed/i,
		/cache|memo|lazy/i,
		/profil|benchmark|metric/i,
		/memory|cpu|latency/i,
		/bundle|minif|compress/i,
		/n\+1|query.?plan/i,
	],
	billing: [
		/payment|billing|charge/i,
		/subscription|plan|tier/i,
		/invoice|receipt|refund/i,
		/stripe|paypal|checkout/i,
		/credit|debit|card/i,
		/revenue|mrr|churn/i,
	],
	user_experience: [
		/ui|ux|user.?experience/i,
		/accessibility|a11y/i,
		/responsive|mobile|viewport/i,
		/animation|transition|interaction/i,
		/form|input|validation.*ui/i,
		/feedback|error.?message|toast/i,
	],
	error_recovery: [
		/error.?handl|exception|catch/i,
		/retry|fallback|recovery/i,
		/graceful|degrad/i,
		/circuit.?breaker|timeout/i,
		/log|monitor|alert/i,
		/debug|diagnos/i,
	],
};

/**
 * Risk levels for domains
 */
const DOMAIN_RISK_LEVELS: Record<string, "low" | "medium" | "high" | "critical"> = {
	security: "critical",
	database: "critical",
	trading: "critical",
	billing: "critical",
	api_integration: "high",
	performance: "high",
	user_experience: "medium",
	error_recovery: "medium",
	general: "low",
	coding: "low",
	research: "low",
};

/**
 * Detect domain from task content
 */
export function detectDomain(task: string): string {
	// Try existing detectExpertDomain first
	const expertDomain = detectExpertDomain(task);
	if (expertDomain) return expertDomain;

	// Pattern-based detection
	let bestMatch = "general";
	let maxScore = 0;

	for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
		let score = 0;
		for (const pattern of patterns) {
			const matches = task.match(pattern);
			if (matches) {
				score += matches.length;
			}
		}
		if (score > maxScore) {
			maxScore = score;
			bestMatch = domain;
		}
	}

	return maxScore > 0 ? bestMatch : "general";
}

/**
 * Get risk level for domain
 */
export function getDomainRiskLevel(domain: string): "low" | "medium" | "high" | "critical" {
	return DOMAIN_RISK_LEVELS[domain] || "low";
}

// ============================================================================
// Expertise Injection
// ============================================================================

/**
 * Build expert context for a task
 */
export function buildExpertContext(task: string, domain?: string): ExpertContext {
	const detectedDomain = domain || detectDomain(task);
	const expertise = loadExpertise(detectedDomain);
	const riskLevel = getDomainRiskLevel(detectedDomain);

	return {
		domain: detectedDomain,
		expertise,
		riskLevel,
	};
}

/**
 * Create enhanced prompt with expertise
 */
export function createExpertPrompt(task: string, context: ExpertContext): string {
	const parts: string[] = [];

	// Add domain header
	parts.push(`## Domain: ${context.domain.replace(/_/g, " ").toUpperCase()}`);

	// Add risk warning for critical domains
	if (context.riskLevel === "critical") {
		parts.push(`
**CRITICAL DOMAIN WARNING**
This is a ${context.domain.replace(/_/g, " ")} task with critical risk level.
- Double-check all changes before committing
- Consider security implications
- Validate against best practices
- Request review if uncertain
`);
	} else if (context.riskLevel === "high") {
		parts.push(`
**HIGH-RISK DOMAIN**
This task involves ${context.domain.replace(/_/g, " ")} which requires careful attention.
- Verify edge cases
- Consider failure modes
- Test thoroughly
`);
	}

	// Add accumulated expertise
	if (context.expertise && context.expertise.length > 0) {
		parts.push(context.expertise);
	}

	// Add codebase expert context if available
	const expert = CODEBASE_EXPERTS[context.domain] || PRODUCT_EXPERTS[context.domain];
	if (expert) {
		parts.push(`\n## Expert Context\n${expert.description}`);
		if (expert.mentalModel) {
			parts.push(`\n**Mental Model:**\n${expert.mentalModel}`);
		}
	}

	// Add self-improve prompt
	const selfImprove = SELF_IMPROVE_PROMPTS[context.domain] || SELF_IMPROVE_PROMPTS.general;
	parts.push(`\n---\n${selfImprove}`);

	// Add original task
	parts.push(`\n---\n## Task\n${task}`);

	return parts.join("\n");
}

// ============================================================================
// Learning Extraction
// ============================================================================

/**
 * Process agent output and extract learnings
 */
export function processAgentOutput(
	output: string,
	domain: string,
	task: string,
	success: boolean,
	config: ExpertHookConfig,
): {
	learned: boolean;
	insight: string;
	expertiseFile: string;
} {
	if (!config.learningEnabled || !success) {
		return {
			learned: false,
			insight: "",
			expertiseFile: getExpertisePath(domain),
		};
	}

	const learnings = extractLearnings(output);
	return updateExpertise(domain, learnings, task, success, {
		maxInsights: config.maxSessionInsights,
	});
}

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Create expert hook for agent system
 */
export function createExpertHook(config: Partial<ExpertHookConfig> = {}): (api: AgentHookAPI) => void {
	const finalConfig: ExpertHookConfig = { ...DEFAULT_CONFIG, ...config };

	return (api: AgentHookAPI) => {
		// Track current task context across events
		let currentTask = "";
		let currentDomain = "";
		let currentContext: ExpertContext | null = null;
		let agentOutput = "";

		// Agent start - detect domain and prepare context
		api.on("agent_start", async (_event, _ctx) => {
			if (!finalConfig.enabled) return;

			// Reset state for new agent run
			agentOutput = "";
		});

		// Turn start - inject expertise into context
		api.on("turn_start", async (event, ctx) => {
			if (!finalConfig.enabled || !finalConfig.autoDetect) return;

			// Domain detection happens on first turn
			if (event.turnIndex === 0 && currentTask) {
				currentDomain = detectDomain(currentTask);
				currentContext = buildExpertContext(currentTask, currentDomain);

				// Notify about detected domain if critical
				if (currentContext.riskLevel === "critical" && ctx.hasUI) {
					ctx.ui.notify(`Domain: ${currentDomain.replace(/_/g, " ")} (CRITICAL)`, "warning");
				}
			}
		});

		// Turn end - accumulate output
		api.on("turn_end", async (event, _ctx) => {
			if (!finalConfig.enabled || !finalConfig.learningEnabled) return;

			// Extract text from message if available
			const message = event.message as { content?: Array<{ type: string; text?: string }> };
			if (message?.content) {
				for (const block of message.content) {
					if (block.type === "text" && block.text) {
						agentOutput += block.text + "\n";
					}
				}
			}
		});

		// Agent end - extract and persist learnings
		api.on("agent_end", async (event, ctx) => {
			if (!finalConfig.enabled || !finalConfig.learningEnabled) return;
			if (!currentDomain || !currentTask) return;

			// Include final output if provided
			if (event.output) {
				agentOutput += event.output;
			}

			// Process learnings
			const result = processAgentOutput(agentOutput, currentDomain, currentTask, event.success, finalConfig);

			if (result.learned && ctx.hasUI) {
				ctx.ui.notify(`Learned: ${result.insight.substring(0, 100)}...`, "info");
			}

			// Reset for next run
			currentTask = "";
			currentDomain = "";
			currentContext = null;
			agentOutput = "";
		});

		// Tool result - domain-specific validation for critical domains
		api.on("tool_result", async (event, ctx) => {
			if (!finalConfig.enabled || !currentContext) return undefined;

			// Only validate for critical domains
			if (currentContext.riskLevel !== "critical") return undefined;

			// Domain-specific validations
			const validations: Array<{
				domain: string;
				toolName: string;
				check: (input: Record<string, unknown>, result: string) => string | null;
			}> = [
				{
					domain: "security",
					toolName: "write",
					check: (input, _result) => {
						const path = input.path as string;
						const content = input.content as string;
						// Check for potential secrets in code
						if (/api[_-]?key|secret|password|token/i.test(content)) {
							return "WARNING: Potential secrets detected in code. Consider using environment variables.";
						}
						return null;
					},
				},
				{
					domain: "database",
					toolName: "bash",
					check: (input, _result) => {
						const cmd = input.command as string;
						// Warn about dangerous database operations
						if (/drop\s+table|truncate|delete\s+from.*where\s+1/i.test(cmd)) {
							return "WARNING: Destructive database operation detected. Verify before proceeding.";
						}
						return null;
					},
				},
				{
					domain: "trading",
					toolName: "bash",
					check: (input, _result) => {
						const cmd = input.command as string;
						// Warn about trading operations
						if (/place.?order|submit|execute.*trade/i.test(cmd)) {
							return "WARNING: Trading operation detected. Verify parameters and risk limits.";
						}
						return null;
					},
				},
			];

			for (const validation of validations) {
				if (validation.domain === currentContext.domain && validation.toolName === event.toolName) {
					const warning = validation.check(event.input, event.result);
					if (warning) {
						if (ctx.hasUI) {
							ctx.ui.notify(warning, "warning");
						}
						// Append warning to result
						return {
							result: event.result + `\n\n[Expert Hook] ${warning}`,
						};
					}
				}
			}

			return undefined;
		});
	};
}

/**
 * Create task-aware expert hook
 * Use this when you have the task content available at registration time
 */
export function createTaskAwareExpertHook(
	task: string,
	config: Partial<ExpertHookConfig> = {},
): (api: AgentHookAPI) => void {
	const baseHook = createExpertHook(config);
	const domain = detectDomain(task);
	const context = buildExpertContext(task, domain);

	return (api: AgentHookAPI) => {
		// Initialize base hook
		baseHook(api);

		// Override to use pre-computed context
		// The base hook will use currentTask which we set here
		(api as any).__expertTask = task;
		(api as any).__expertDomain = domain;
		(api as any).__expertContext = context;
	};
}

/**
 * Default expert hook instance
 */
export const expertHook = createExpertHook();

/**
 * Export utilities
 */
export const ExpertUtils = {
	detectDomain,
	getDomainRiskLevel,
	buildExpertContext,
	createExpertPrompt,
	processAgentOutput,
	DOMAIN_PATTERNS,
	DOMAIN_RISK_LEVELS,
};
