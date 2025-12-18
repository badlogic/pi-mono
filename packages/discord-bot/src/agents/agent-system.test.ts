/**
 * Comprehensive Agent System Tests
 * Tests TAC Lesson 13 Agent Experts, Two-Phase Workflow, and Act-Learn-Reuse
 */

import { existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// Agent Experts
import {
	CODEBASE_EXPERTS,
	detectExpertDomain,
	getExpert,
	META_PROMPT_TEMPLATE,
	PRODUCT_EXPERTS,
} from "./agent-experts.js";
// Claude SDK (Two-Phase)
import { getTaskStatus, isClaudeSDKAvailable } from "./claude-sdk-agent.js";
// Expertise Manager
import {
	createLearningPrompt,
	extractLearnings,
	getExpertiseModes,
	loadExpertise,
	SELF_IMPROVE_PROMPTS,
} from "./expertise-manager.js";

// Lightweight Agent
import { AGENT_MODELS, getAgentModels, isAgentAvailable } from "./lightweight-agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXPERTISE_DIR = join(__dirname, "expertise");

describe("Agent Experts System", () => {
	describe("CODEBASE_EXPERTS", () => {
		it("should have all required domains", () => {
			const requiredDomains = ["security", "database", "trading", "api_integration", "billing", "performance"];
			for (const domain of requiredDomains) {
				expect(CODEBASE_EXPERTS[domain]).toBeDefined();
			}
		});

		it("should have valid risk levels", () => {
			for (const [domain, expert] of Object.entries(CODEBASE_EXPERTS)) {
				expect(["critical", "high", "medium"]).toContain(expert.riskLevel);
			}
		});

		it("should have selfImprovePrompt for each expert", () => {
			for (const [domain, expert] of Object.entries(CODEBASE_EXPERTS)) {
				expect(expert.selfImprovePrompt).toBeTruthy();
				expect(expert.selfImprovePrompt.length).toBeGreaterThan(50);
			}
		});
	});

	describe("PRODUCT_EXPERTS", () => {
		it("should have user_experience, error_recovery, workflow_optimization", () => {
			expect(PRODUCT_EXPERTS.user_experience).toBeDefined();
			expect(PRODUCT_EXPERTS.error_recovery).toBeDefined();
			expect(PRODUCT_EXPERTS.workflow_optimization).toBeDefined();
		});

		it("should have focus and selfImprovePrompt", () => {
			for (const [name, expert] of Object.entries(PRODUCT_EXPERTS)) {
				expect(expert.focus).toBeTruthy();
				expect(expert.selfImprovePrompt).toBeTruthy();
			}
		});
	});

	describe("detectExpertDomain", () => {
		it("should detect security domain", () => {
			expect(detectExpertDomain("Review authentication for vulnerabilities")).toBe("security");
			expect(detectExpertDomain("Check OWASP compliance")).toBe("security");
			expect(detectExpertDomain("Fix XSS injection issue")).toBe("security");
		});

		it("should detect database domain", () => {
			expect(detectExpertDomain("Optimize database query")).toBe("database");
			expect(detectExpertDomain("Create SQL migration")).toBe("database");
			expect(detectExpertDomain("Add index to table")).toBe("database");
		});

		it("should detect trading domain", () => {
			expect(detectExpertDomain("Calculate portfolio risk")).toBe("trading");
			expect(detectExpertDomain("Backtest trading strategy")).toBe("trading");
			expect(detectExpertDomain("Analyze market volatility")).toBe("trading");
		});

		it("should detect api_integration domain", () => {
			expect(detectExpertDomain("Add webhook endpoint")).toBe("api_integration");
			expect(detectExpertDomain("Handle API rate limiting")).toBe("api_integration");
		});

		it("should detect billing domain", () => {
			expect(detectExpertDomain("Process payment subscription")).toBe("billing");
			expect(detectExpertDomain("Handle invoice generation")).toBe("billing");
		});

		it("should detect performance domain", () => {
			expect(detectExpertDomain("Profile memory usage")).toBe("performance");
			expect(detectExpertDomain("Optimize caching strategy")).toBe("performance");
		});

		it("should default to general for unknown tasks", () => {
			expect(detectExpertDomain("Do something random")).toBe("general");
		});
	});

	describe("getExpert", () => {
		it("should return expert with required methods", () => {
			const expert = getExpert("security");
			expect(typeof expert.selfImprovePrompt).toBe("string");
			expect(typeof expert.loadExpertise).toBe("function");
			expect(typeof expert.createPrompt).toBe("function");
			expect(typeof expert.learn).toBe("function");
		});

		it("should create valid prompts", () => {
			const expert = getExpert("security");
			const prompt = expert.createPrompt("Review this code");
			expect(prompt).toContain("Review this code");
			expect(prompt).toContain("---");
		});
	});

	describe("META_PROMPT_TEMPLATE", () => {
		it("should have task and expertise placeholders", () => {
			expect(META_PROMPT_TEMPLATE).toContain("{{TASK}}");
			expect(META_PROMPT_TEMPLATE).toContain("{{EXPERTISE}}");
		});
	});
});

describe("Expertise Manager", () => {
	describe("Expertise Files", () => {
		it("should have expertise directory", () => {
			expect(existsSync(EXPERTISE_DIR)).toBe(true);
		});

		it("should have expertise files for all CODEBASE_EXPERTS", () => {
			const requiredFiles = [
				"security.md",
				"database.md",
				"trading.md",
				"api_integration.md",
				"billing.md",
				"performance.md",
			];
			const files = readdirSync(EXPERTISE_DIR);
			for (const file of requiredFiles) {
				expect(files).toContain(file);
			}
		});

		it("should have meta_agentic.md for meta-learning", () => {
			const files = readdirSync(EXPERTISE_DIR);
			expect(files).toContain("meta_agentic.md");
		});
	});

	describe("loadExpertise", () => {
		it("should load existing expertise", () => {
			const expertise = loadExpertise("general");
			expect(expertise).toBeTruthy();
			expect(typeof expertise).toBe("string");
		});

		it("should return empty string for non-existent expertise", () => {
			const expertise = loadExpertise("nonexistent_domain_xyz");
			expect(expertise).toBe("");
		});
	});

	describe("extractLearnings", () => {
		it("should extract learnings from output with markers", () => {
			const output = `Some output here
## What I Learned
- Important lesson 1
- Important lesson 2
More content`;
			const learnings = extractLearnings(output);
			expect(learnings).toContain("Important lesson");
		});

		it("should return empty for output without markers", () => {
			const output = "Just regular output with no learning markers";
			const learnings = extractLearnings(output);
			expect(learnings).toBe("");
		});
	});

	describe("SELF_IMPROVE_PROMPTS", () => {
		it("should have prompts for common modes", () => {
			expect(SELF_IMPROVE_PROMPTS.general).toBeTruthy();
			expect(SELF_IMPROVE_PROMPTS.coding).toBeTruthy();
			expect(SELF_IMPROVE_PROMPTS.trading).toBeTruthy();
		});
	});

	describe("getExpertiseModes", () => {
		it("should return array of available modes", () => {
			const modes = getExpertiseModes();
			expect(Array.isArray(modes)).toBe(true);
			expect(modes.length).toBeGreaterThan(5);
			expect(modes).toContain("general");
		});
	});

	describe("createLearningPrompt", () => {
		it("should create prompt with task and self-improve instructions", () => {
			const prompt = createLearningPrompt("Do this task", "coding");
			expect(prompt).toContain("Do this task");
			expect(prompt).toContain("---");
		});
	});
});

describe("Claude SDK (Two-Phase)", () => {
	describe("isClaudeSDKAvailable", () => {
		it("should return boolean", () => {
			const available = isClaudeSDKAvailable();
			expect(typeof available).toBe("boolean");
		});
	});

	describe("getTaskStatus", () => {
		it("should return exists: false for non-existent task", () => {
			const status = getTaskStatus("nonexistent-task-id-xyz");
			expect(status.exists).toBe(false);
		});
	});
});

describe("Lightweight Agent", () => {
	describe("isAgentAvailable", () => {
		it("should return boolean", () => {
			const available = isAgentAvailable();
			expect(typeof available).toBe("boolean");
		});
	});

	describe("AGENT_MODELS", () => {
		it("should have model definitions", () => {
			expect(Object.keys(AGENT_MODELS).length).toBeGreaterThan(0);
		});

		it("should have GLM model (Z.ai provider)", () => {
			expect(AGENT_MODELS["glm-4.6"]).toBeDefined();
			expect(AGENT_MODELS["glm-4.6"].provider).toBe("zai");
		});
	});

	describe("getAgentModels", () => {
		it("should return record of model names", () => {
			const models = getAgentModels();
			expect(typeof models).toBe("object");
			expect(Object.keys(models).length).toBeGreaterThan(0);
		});
	});
});

describe("Integration", () => {
	describe("Act-Learn-Reuse Cycle", () => {
		it("should have all components for the cycle", () => {
			// ACT: Execute with expertise
			expect(typeof getExpert).toBe("function");
			expect(typeof detectExpertDomain).toBe("function");

			// LEARN: Extract learnings
			expect(typeof extractLearnings).toBe("function");

			// REUSE: Load and apply expertise
			expect(typeof loadExpertise).toBe("function");
			expect(typeof createLearningPrompt).toBe("function");
		});

		it("should connect expertise to experts", () => {
			// Each expert should be able to load its expertise
			for (const domain of Object.keys(CODEBASE_EXPERTS)) {
				const expert = getExpert(domain);
				const expertise = expert.loadExpertise();
				// Expertise file exists (may be empty initially)
				expect(typeof expertise).toBe("string");
			}
		});
	});

	describe("Two-Phase Workflow Components", () => {
		it("should have initializer and executor phases", async () => {
			// Import dynamically to check exports
			const claudeModule = await import("./claude-sdk-agent.js");
			expect(claudeModule.initializeTask).toBeDefined();
			expect(claudeModule.executeNextFeature).toBeDefined();
			expect(claudeModule.runTwoAgentWorkflow).toBeDefined();
			expect(claudeModule.resumeTask).toBeDefined();
		});
	});
});
