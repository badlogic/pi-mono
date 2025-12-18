/**
 * Agent Experts - Advanced TAC Lesson 13 Implementation
 *
 * "The massive problem with agents is they forget - and that means they don't learn.
 *  Agent Experts solve this with a three-step workflow: Act, Learn, Reuse."
 *
 * Key Principles:
 * - Mental Models: Data structures that evolve over time
 * - Self-Improving Template Meta Prompts: Prompts that build other prompts
 * - Meta Agentics: Prompts writing prompts, agents building agents
 * - Never update expertise files directly - teach agents HOW to learn
 * - Codebase Experts for high-risk systems
 * - Product-Focused Experts for adaptive experiences
 *
 * Based on: https://agenticengineer.com/tactical-agentic-coding
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
	extractLearnings,
	getExpertisePath,
	type LearningResult,
	loadExpertise,
	SELF_IMPROVE_PROMPTS,
	updateExpertise,
} from "./expertise-manager.js";

// Get paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");
const EXPERTISE_DIR = join(packageRoot, "src", "agents", "expertise");
const META_DIR = join(packageRoot, "src", "agents", "meta");

// ============================================================================
// CODEBASE EXPERTS - Domain-specific experts for high-risk systems
// ============================================================================

/**
 * Codebase Expert Definitions
 * Deploy these for critical areas: security, database, payments, trading
 */
export const CODEBASE_EXPERTS: Record<
	string,
	{
		name: string;
		description: string;
		riskLevel: "critical" | "high" | "medium";
		selfImprovePrompt: string;
		mentalModel: string;
	}
> = {
	security: {
		name: "Security Expert",
		description: "Authentication, authorization, secrets management, OWASP compliance",
		riskLevel: "critical",
		selfImprovePrompt: `After this security task, document critical learnings:

## Security Learnings
1. **Vulnerabilities Found**: What security issues were identified?
2. **Patterns Applied**: What security patterns proved effective?
3. **OWASP Compliance**: Which OWASP guidelines were relevant?
4. **Secrets Handling**: How were sensitive data handled?
5. **Attack Vectors**: What attack surfaces were considered?

## Anti-Patterns to Avoid
- Document any insecure patterns encountered
- Note any common security mistakes

## Best Practices Confirmed
- What secure coding practices should be reinforced?`,
		mentalModel: `A Security Expert accumulates knowledge about:
- Common vulnerability patterns in this codebase
- Secure authentication/authorization flows
- Secrets management best practices
- Input validation and sanitization
- SQL injection, XSS, CSRF prevention
- Rate limiting and abuse prevention`,
	},

	database: {
		name: "Database Expert",
		description: "Schema design, migrations, query optimization, data integrity",
		riskLevel: "critical",
		selfImprovePrompt: `After this database task, document learnings:

## Database Learnings
1. **Schema Patterns**: What schema designs were effective?
2. **Query Optimization**: What performance improvements were made?
3. **Migration Safety**: How were migrations handled safely?
4. **Data Integrity**: What constraints ensure data quality?
5. **Index Strategy**: What indexing decisions were made?

## Anti-Patterns to Avoid
- N+1 queries, missing indexes, unsafe migrations

## Performance Insights
- Query patterns, connection pooling, caching strategies`,
		mentalModel: `A Database Expert accumulates knowledge about:
- Schema evolution patterns for this codebase
- Query performance bottlenecks and solutions
- Safe migration strategies
- Data integrity constraints
- Backup and recovery procedures`,
	},

	trading: {
		name: "Trading Strategy Expert",
		description: "Market analysis, signal generation, risk management, execution",
		riskLevel: "critical",
		selfImprovePrompt: `After this trading analysis, document learnings:

## Trading Learnings
1. **Market Patterns**: What patterns were identified?
2. **Signal Quality**: Which signals proved reliable?
3. **Risk Factors**: What risk considerations emerged?
4. **Execution Issues**: Any slippage, timing, or execution insights?
5. **Indicator Effectiveness**: Which indicators were most useful?

## Strategy Insights
- Entry/exit patterns that worked
- Position sizing considerations
- Correlation observations

## Pitfalls to Avoid
- False signals, over-trading, poor risk management`,
		mentalModel: `A Trading Expert accumulates knowledge about:
- Market microstructure for traded assets
- Reliable signal patterns vs noise
- Risk management frameworks
- Execution optimization
- Portfolio correlation dynamics`,
	},

	api_integration: {
		name: "API Integration Expert",
		description: "External API interactions, error handling, rate limiting, retries",
		riskLevel: "high",
		selfImprovePrompt: `After this API integration task, document learnings:

## Integration Learnings
1. **API Quirks**: What undocumented behaviors were discovered?
2. **Error Patterns**: What error scenarios were handled?
3. **Rate Limits**: How were rate limits managed?
4. **Retry Strategy**: What retry patterns proved effective?
5. **Data Mapping**: How was data transformed?

## Reliability Insights
- Circuit breaker patterns, timeout strategies

## Anti-Patterns
- Blocking calls, missing error handling, tight coupling`,
		mentalModel: `An API Integration Expert accumulates knowledge about:
- Specific API quirks and undocumented behaviors
- Effective error handling strategies
- Rate limiting and backoff patterns
- Data transformation approaches
- Reliability patterns (circuit breakers, retries)`,
	},

	billing: {
		name: "Billing/Payment Expert",
		description: "Payment processing, subscriptions, invoicing, compliance",
		riskLevel: "critical",
		selfImprovePrompt: `After this billing task, document learnings:

## Billing Learnings
1. **Payment Flows**: What payment patterns were implemented?
2. **Edge Cases**: What billing edge cases were handled?
3. **Compliance**: What compliance requirements were met?
4. **Reconciliation**: How was data reconciled?
5. **Fraud Prevention**: What fraud patterns were considered?

## Critical Safeguards
- Idempotency, audit trails, refund handling

## Anti-Patterns
- Race conditions, missing idempotency, poor audit trails`,
		mentalModel: `A Billing Expert accumulates knowledge about:
- Payment processor quirks (Stripe, PayPal, etc.)
- Subscription lifecycle management
- Compliance requirements (PCI-DSS, tax)
- Fraud detection patterns
- Reconciliation procedures`,
	},

	performance: {
		name: "Performance Expert",
		description: "Profiling, optimization, caching, scalability",
		riskLevel: "high",
		selfImprovePrompt: `After this performance task, document learnings:

## Performance Learnings
1. **Bottlenecks Found**: What were the main performance issues?
2. **Optimizations Applied**: What improvements were made?
3. **Metrics Captured**: What measurements guided decisions?
4. **Caching Strategy**: How was caching applied?
5. **Scalability Considerations**: What scaling factors emerged?

## Optimization Patterns
- Effective techniques for this codebase

## Anti-Patterns
- Premature optimization, cache invalidation issues`,
		mentalModel: `A Performance Expert accumulates knowledge about:
- Performance bottleneck patterns in this codebase
- Effective optimization techniques
- Caching strategies and invalidation
- Database query optimization
- Memory and CPU profiling insights`,
	},
};

// ============================================================================
// META-AGENTIC SYSTEM - Agents building agents, prompts writing prompts
// ============================================================================

/**
 * Meta Prompt Template - A prompt that generates other prompts
 * This is the "prompt that builds prompts" pattern from TAC Lesson 13
 */
export const META_PROMPT_TEMPLATE = `You are a Meta-Agentic System that creates and improves agent configurations.

## Your Role
You build agents that build things. Your output is not code or analysis - it's agent configurations,
prompts, and expertise structures that other agents will use.

## Current Task
{{TASK}}

## Output Format
Generate one of the following based on the task:

### 1. New Expert Configuration
\`\`\`typescript
{
  name: "Expert Name",
  description: "What this expert handles",
  riskLevel: "critical" | "high" | "medium",
  selfImprovePrompt: "The prompt that teaches this agent HOW to learn...",
  mentalModel: "Description of what knowledge this expert accumulates..."
}
\`\`\`

### 2. Self-Improve Prompt
A prompt that teaches an agent how to extract and document learnings from its task execution.
Must include: Learning categories, Anti-patterns section, Best practices section.

### 3. Expertise File Template
A markdown template for storing accumulated expertise, with sections for:
- Mental Model (evolving description)
- Patterns Learned
- Common Pitfalls
- Effective Approaches
- Session Insights (bounded to last N sessions)

## Meta-Agentic Principles
1. Never update expertise directly - create prompts that teach agents to learn
2. Mental models are data structures that evolve over time
3. Self-improving prompts must guide structured learning extraction
4. Every expert needs bounded growth (prevent unbounded expertise files)

## Accumulated Meta-Expertise
{{EXPERTISE}}`;

/**
 * Create a new codebase expert dynamically
 * This is the "agents building agents" pattern
 */
export async function createCodebaseExpert(
	domain: string,
	description: string,
	executor: (prompt: string) => Promise<{ success: boolean; output: string }>,
): Promise<{ success: boolean; expert?: (typeof CODEBASE_EXPERTS)[string]; error?: string }> {
	const metaExpertise = loadExpertise("meta_agentic");

	const prompt = META_PROMPT_TEMPLATE.replace(
		"{{TASK}}",
		`Create a new Codebase Expert for: ${domain}\n\nDescription: ${description}`,
	).replace("{{EXPERTISE}}", metaExpertise || "No meta-expertise accumulated yet.");

	const { success, output } = await executor(prompt);

	if (!success) {
		return { success: false, error: "Meta agent failed to generate expert" };
	}

	// Extract expert configuration from output
	const configMatch = output.match(/```typescript\s*\n([\s\S]*?)\n```/);
	if (!configMatch) {
		return { success: false, error: "Could not parse expert configuration from output" };
	}

	try {
		// Parse the configuration (safely)
		const configStr = configMatch[1];
		const expert = {
			name: extractField(configStr, "name") || `${domain} Expert`,
			description: extractField(configStr, "description") || description,
			riskLevel: (extractField(configStr, "riskLevel") as "critical" | "high" | "medium") || "medium",
			selfImprovePrompt: extractField(configStr, "selfImprovePrompt") || SELF_IMPROVE_PROMPTS.general,
			mentalModel: extractField(configStr, "mentalModel") || `Accumulated expertise for ${domain} tasks.`,
		};

		// Save the new expert
		saveExpertConfig(domain, expert);

		// Create expertise file
		createExpertiseFile(domain, expert);

		// Learn from creating this expert (meta-learning!)
		const learnings = `Created new ${domain} expert with ${expert.riskLevel} risk level. Mental model focuses on: ${expert.mentalModel.substring(0, 100)}...`;
		updateExpertise("meta_agentic", learnings, `Create ${domain} expert`, true);

		return { success: true, expert };
	} catch (error) {
		return { success: false, error: `Failed to parse expert: ${error}` };
	}
}

/**
 * Extract a field value from TypeScript-like object string
 */
function extractField(str: string, field: string): string {
	const patterns = [
		new RegExp(`${field}:\\s*["'\`]([^"'\`]+)["'\`]`, "i"),
		new RegExp(`${field}:\\s*["'\`]([\\s\\S]*?)["'\`](?:,|\\s*})`, "i"),
	];

	for (const pattern of patterns) {
		const match = str.match(pattern);
		if (match) return match[1].trim();
	}
	return "";
}

/**
 * Save expert configuration to file
 */
function saveExpertConfig(domain: string, expert: (typeof CODEBASE_EXPERTS)[string]): void {
	if (!existsSync(META_DIR)) {
		mkdirSync(META_DIR, { recursive: true });
	}

	const configPath = join(META_DIR, `${domain}-expert.json`);
	writeFileSync(configPath, JSON.stringify(expert, null, 2));
}

/**
 * Load a saved expert configuration
 */
export function loadExpertConfig(domain: string): (typeof CODEBASE_EXPERTS)[string] | null {
	// First check built-in experts
	if (CODEBASE_EXPERTS[domain]) {
		return CODEBASE_EXPERTS[domain];
	}

	// Then check saved configs
	const configPath = join(META_DIR, `${domain}-expert.json`);
	if (existsSync(configPath)) {
		try {
			const content = readFileSync(configPath, "utf-8");
			return JSON.parse(content);
		} catch {
			return null;
		}
	}

	return null;
}

/**
 * Create expertise file for a new expert
 */
function createExpertiseFile(domain: string, expert: (typeof CODEBASE_EXPERTS)[string]): void {
	const expertisePath = getExpertisePath(domain);

	if (existsSync(expertisePath)) {
		return; // Don't overwrite existing expertise
	}

	const template = `# ${expert.name}

## Mental Model
${expert.mentalModel}

*Last updated: Never*
*Risk Level: ${expert.riskLevel}*
*Total sessions: 0*

## Patterns Learned
<!-- Agent updates this section with successful patterns -->

## Common Pitfalls
<!-- Agent updates this section with mistakes to avoid -->

## Effective Approaches
<!-- Agent updates this section with approaches that worked well -->

## Session Insights
<!-- Recent learning sessions are stored here -->
`;

	if (!existsSync(EXPERTISE_DIR)) {
		mkdirSync(EXPERTISE_DIR, { recursive: true });
	}

	writeFileSync(expertisePath, template);
}

// ============================================================================
// SELF-IMPROVING TEMPLATE META PROMPTS
// ============================================================================

/**
 * Template Meta Prompt Generator
 * Creates self-improving prompts for any domain
 */
export function generateSelfImprovePrompt(domain: string, categories: string[], antiPatternFocus?: string): string {
	const categoryQuestions = categories
		.map((cat, i) => `${i + 1}. **${cat}**: What insights emerged about ${cat.toLowerCase()}?`)
		.join("\n");

	return `After completing this ${domain} task, document your learnings:

## ${domain} Learnings
${categoryQuestions}

## Anti-Patterns to Avoid
${antiPatternFocus || `- Document any ${domain.toLowerCase()} anti-patterns encountered`}
- Note common mistakes to prevent in future

## Best Practices Confirmed
- What ${domain.toLowerCase()} practices should be reinforced?
- What approaches proved most effective?

Format as structured markdown for expertise accumulation.`;
}

/**
 * Get or create a domain expert with self-improving capabilities
 */
export function getExpert(domain: string): {
	selfImprovePrompt: string;
	loadExpertise: () => string;
	createPrompt: (task: string) => string;
	learn: (output: string, task: string, success: boolean) => LearningResult;
} {
	const expert = loadExpertConfig(domain);

	const selfImprovePrompt = expert?.selfImprovePrompt || SELF_IMPROVE_PROMPTS[domain] || SELF_IMPROVE_PROMPTS.general;

	return {
		selfImprovePrompt,

		loadExpertise: () => loadExpertise(domain),

		createPrompt: (task: string) => {
			const expertise = loadExpertise(domain);
			return `${task}

${expertise}

---
${selfImprovePrompt}`;
		},

		learn: (output: string, task: string, success: boolean) => {
			const learnings = extractLearnings(output);
			return updateExpertise(domain, learnings, task, success);
		},
	};
}

// ============================================================================
// ACT-LEARN-REUSE WITH EXPERT SELECTION
// ============================================================================

/**
 * Execute a task with the appropriate codebase expert
 * Automatically selects expert based on task domain
 */
export async function executeWithExpert<T>(
	task: string,
	domain: string,
	executor: (enhancedTask: string) => Promise<{ success: boolean; output: string; result?: T }>,
): Promise<{
	success: boolean;
	output: string;
	learned: LearningResult;
	expert: string;
	result?: T;
}> {
	const expert = getExpert(domain);

	// Create enhanced prompt with expertise and self-improve instructions
	const enhancedTask = expert.createPrompt(task);

	// ACT: Execute the task
	const { success, output, result } = await executor(enhancedTask);

	// LEARN: Extract and store learnings
	const learned = expert.learn(output, task, success);

	return {
		success,
		output,
		learned,
		expert: domain,
		result,
	};
}

/**
 * Detect the best expert for a task based on keywords
 */
export function detectExpertDomain(task: string): string {
	const taskLower = task.toLowerCase();

	const domainKeywords: Record<string, string[]> = {
		security: [
			"security",
			"auth",
			"authentication",
			"authorization",
			"owasp",
			"vulnerability",
			"secrets",
			"encrypt",
			"password",
			"token",
			"csrf",
			"xss",
			"injection",
		],
		database: [
			"database",
			"schema",
			"migration",
			"query",
			"sql",
			"index",
			"table",
			"postgresql",
			"mysql",
			"sqlite",
			"mongodb",
			"orm",
		],
		trading: [
			"trading",
			"market",
			"signal",
			"strategy",
			"price",
			"indicator",
			"position",
			"order",
			"exchange",
			"crypto",
			"stock",
			"portfolio",
			"risk",
			"profit",
			"loss",
			"backtest",
			"sharpe",
			"drawdown",
			"volatility",
		],
		api_integration: [
			"api",
			"integration",
			"webhook",
			"endpoint",
			"rest",
			"graphql",
			"rate limit",
			"retry",
			"external service",
		],
		billing: ["billing", "payment", "subscription", "invoice", "stripe", "paypal", "charge", "refund", "transaction"],
		performance: [
			"performance",
			"optimize",
			"cache",
			"profil",
			"bottleneck",
			"memory",
			"cpu",
			"latency",
			"throughput",
			"scale",
		],
	};

	for (const [domain, keywords] of Object.entries(domainKeywords)) {
		if (keywords.some((kw) => taskLower.includes(kw))) {
			return domain;
		}
	}

	return "general";
}

/**
 * Auto-select expert and execute task
 */
export async function executeWithAutoExpert<T>(
	task: string,
	executor: (enhancedTask: string) => Promise<{ success: boolean; output: string; result?: T }>,
): Promise<{
	success: boolean;
	output: string;
	learned: LearningResult;
	expert: string;
	result?: T;
}> {
	const domain = detectExpertDomain(task);
	return executeWithExpert(task, domain, executor);
}

// ============================================================================
// PRODUCT EXPERTS - Beyond code, adaptive user experiences
// ============================================================================

/**
 * Product Expert Definitions
 * These learn user patterns and improve product experience
 */
export const PRODUCT_EXPERTS: Record<
	string,
	{
		name: string;
		focus: string;
		selfImprovePrompt: string;
	}
> = {
	user_experience: {
		name: "User Experience Expert",
		focus: "User interaction patterns, preferences, and pain points",
		selfImprovePrompt: `After this interaction, document UX learnings:

## UX Insights
1. **User Intent**: What was the user trying to accomplish?
2. **Friction Points**: Where did the user struggle?
3. **Preferences**: What patterns does this user prefer?
4. **Success Factors**: What made this interaction successful?

## Experience Improvements
- How can similar interactions be improved?`,
	},

	error_recovery: {
		name: "Error Recovery Expert",
		focus: "Error patterns, recovery strategies, graceful degradation",
		selfImprovePrompt: `After this error handling task, document learnings:

## Error Learnings
1. **Error Pattern**: What type of error occurred?
2. **Root Cause**: What was the underlying issue?
3. **Recovery Strategy**: How was it handled?
4. **Prevention**: How can this be prevented?

## Recovery Patterns
- Effective recovery approaches for similar errors`,
	},

	workflow_optimization: {
		name: "Workflow Expert",
		focus: "Process efficiency, automation opportunities, bottleneck identification",
		selfImprovePrompt: `After this workflow task, document learnings:

## Workflow Insights
1. **Process Efficiency**: What steps could be streamlined?
2. **Automation Opportunities**: What could be automated?
3. **Bottlenecks**: Where were delays or issues?
4. **Best Sequence**: What order works best?

## Optimization Patterns
- Workflow improvements to apply`,
	},
};

// ============================================================================
// EXPORTS
// ============================================================================

// Export types
export type { LearningResult } from "./expertise-manager.js";
export {
	// Re-export from expertise-manager for convenience
	actLearnReuse,
	createLearningPrompt,
	extractLearnings,
	getExpertiseModes,
	getExpertisePath,
	loadExpertise,
	SELF_IMPROVE_PROMPTS,
	updateExpertise,
} from "./expertise-manager.js";
