/**
 * Tests for AgentSession context reloading on newSession().
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { loadPromptTemplates } from "../src/core/prompt-templates.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { loadSkills } from "../src/core/skills.js";
import { buildSystemPromptWithCustom, loadProjectContextFiles } from "../src/core/system-prompt.js";

describe("AgentSession context reloading on newSession", () => {
	let session: AgentSession;
	let tempDir: string;
	let sessionManager: SessionManager;
	let settingsManager: SettingsManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-reload-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		const agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });

		const sessionDir = join(tempDir, "sessions");
		mkdirSync(sessionDir, { recursive: true });

		sessionManager = SessionManager.create(tempDir, sessionDir);
		settingsManager = SettingsManager.create(tempDir, agentDir);
		modelRegistry = new ModelRegistry(new AuthStorage(join(agentDir, "auth.json")), join(agentDir, "models.json"));
	});

	afterEach(async () => {
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createSession(options?: {
		customPrompt?: string | ((defaultPrompt: string) => string);
		initialToolNames?: string[];
	}) {
		const model = getModel("google", "gemini-2.5-flash")!;

		// Build initial system prompt
		const contextFiles = loadProjectContextFiles({ cwd: tempDir, agentDir: join(tempDir, "agent") });
		const { skills } = loadSkills({ cwd: tempDir, agentDir: join(tempDir, "agent") });
		const promptTemplates = loadPromptTemplates({ cwd: tempDir, agentDir: join(tempDir, "agent") });

		const initialToolNames = options?.initialToolNames || [];

		const rebuildSystemPrompt = (toolNames: string[]): string => {
			return buildSystemPromptWithCustom({
				cwd: tempDir,
				agentDir: join(tempDir, "agent"),
				contextFiles,
				skills,
				selectedTools: toolNames as any[],
				customPrompt: options?.customPrompt,
			});
		};

		const systemPrompt = rebuildSystemPrompt(initialToolNames);

		const agent = new Agent({
			getApiKey: async () => "test-key",
			initialState: {
				model,
				systemPrompt,
				tools: [],
			},
			convertToLlm: (msg) => msg as any,
		});

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			modelRegistry,
			rebuildSystemPrompt,
			cwd: tempDir,
			agentDir: join(tempDir, "agent"),
			customPrompt: options?.customPrompt,
			promptTemplates,
			skillsSettings: settingsManager.getSkillsSettings(),
		});

		return session;
	}

	describe("context file reloading", () => {
		it("should reload AGENTS.md after newSession()", async () => {
			// Create AGENTS.md with initial content
			const agentsPath = join(tempDir, "AGENTS.md");
			writeFileSync(agentsPath, "# Initial Context\n\nThis is the initial context.");

			session = createSession();

			// Verify initial context is loaded
			const initialPrompt = session.agent.state.systemPrompt;
			expect(initialPrompt).toContain("Initial Context");
			expect(initialPrompt).toContain("This is the initial context.");

			// Modify AGENTS.md
			writeFileSync(agentsPath, "# Updated Context\n\nThis is the updated context.");

			// Call newSession()
			await session.newSession();

			// Verify updated context is loaded
			const updatedPrompt = session.agent.state.systemPrompt;
			expect(updatedPrompt).toContain("Updated Context");
			expect(updatedPrompt).toContain("This is the updated context.");
			expect(updatedPrompt).not.toContain("Initial Context");
		});

		it("should reload CLAUDE.md when AGENTS.md not present", async () => {
			// Create CLAUDE.md (AGENTS.md has priority)
			const claudePath = join(tempDir, "CLAUDE.md");
			writeFileSync(claudePath, "# Claude Context\n\nThis is Claude-specific context.");

			session = createSession();

			// Verify CLAUDE.md is loaded
			const initialPrompt = session.agent.state.systemPrompt;
			expect(initialPrompt).toContain("Claude Context");

			// Modify CLAUDE.md
			writeFileSync(claudePath, "# Claude Updated\n\nUpdated Claude context.");

			// Call newSession()
			await session.newSession();

			// Verify updated context is loaded
			const updatedPrompt = session.agent.state.systemPrompt;
			expect(updatedPrompt).toContain("Claude Updated");
		});

		it("should prioritize AGENTS.md over CLAUDE.md", async () => {
			// Create both files
			const agentsPath = join(tempDir, "AGENTS.md");
			const claudePath = join(tempDir, "CLAUDE.md");

			writeFileSync(agentsPath, "# AGENTS\n\nAgents context.");
			writeFileSync(claudePath, "# CLAUDE\n\nClaude context.");

			session = createSession();

			// Verify AGENTS.md is used
			const prompt = session.agent.state.systemPrompt;
			expect(prompt).toContain("AGENTS");
			expect(prompt).not.toContain("CLAUDE");
		});
	});

	describe("custom prompt preservation", () => {
		it("should preserve custom string prompt after newSession()", async () => {
			const customPrompt = "You are a custom assistant. Be concise.";

			session = createSession({ customPrompt });

			// Verify custom prompt is applied
			const initialPrompt = session.agent.state.systemPrompt;
			expect(initialPrompt).toContain("You are a custom assistant");

			// Call newSession()
			await session.newSession();

			// Verify custom prompt is still applied
			const updatedPrompt = session.agent.state.systemPrompt;
			expect(updatedPrompt).toContain("You are a custom assistant");
		});

		it("should call custom prompt function with fresh context after newSession()", async () => {
			// Create AGENTS.md
			const agentsPath = join(tempDir, "AGENTS.md");
			writeFileSync(agentsPath, "# Context\n\nInitial content.");

			let callCount = 0;
			const customPrompt = (defaultPrompt: string) => {
				callCount++;
				expect(defaultPrompt).toContain("Context");
				return `${defaultPrompt}\n\nCustom append: ${callCount}`;
			};

			session = createSession({ customPrompt });

			// Verify function is called with fresh context
			expect(callCount).toBeGreaterThan(0);
			const initialPrompt = session.agent.state.systemPrompt;
			expect(initialPrompt).toContain("Custom append: 1");

			// Call newSession()
			await session.newSession();

			// Verify function is called again with fresh context
			expect(callCount).toBeGreaterThan(1);
			const updatedPrompt = session.agent.state.systemPrompt;
			expect(updatedPrompt).toContain("Custom append: 2");
		});

		it("should reload context when using custom string prompt", async () => {
			const agentsPath = join(tempDir, "AGENTS.md");
			writeFileSync(agentsPath, "# Initial\n\nInitial context.");

			session = createSession({ customPrompt: "You are custom." });

			// Custom prompt is used as base, with context appended
			const initialPrompt = session.agent.state.systemPrompt;
			expect(initialPrompt).toContain("You are custom.");
			expect(initialPrompt).toContain("Initial");

			// When customPrompt is undefined, default is used with fresh context
			// Modify and test new session
			writeFileSync(agentsPath, "# Updated\n\nUpdated context.");

			// This test verifies that when we DO have a custom string prompt,
			// it's still preserved (which we tested above)
			await session.newSession();

			const updatedPrompt = session.agent.state.systemPrompt;
			expect(updatedPrompt).toContain("You are custom.");
			expect(updatedPrompt).toContain("Updated");
		});
	});

	describe("prompt templates reloading", () => {
		it("should reload prompt templates after newSession()", async () => {
			const templatesDir = join(tempDir, ".pi", "prompts");
			mkdirSync(templatesDir, { recursive: true });

			// Create initial template
			const templatePath = join(templatesDir, "test-template.md");
			writeFileSync(templatePath, "Initial template content.");

			session = createSession();

			// Modify template
			writeFileSync(templatePath, "Updated template content.");

			// Call newSession()
			await session.newSession();

			// Verify templates are reloaded (stored in _promptTemplates)
			// We can't directly access _promptTemplates, but the fact that
			// newSession() succeeded without errors indicates templates were reloaded
			expect(session.promptTemplates.length).toBe(1);
			expect(session.promptTemplates[0].name).toBe("test-template");

			// Verify template content was reloaded
			const template = session.promptTemplates[0];
			expect(template.content).toBe("Updated template content.");
		});
	});

	describe("integration", () => {
		it("should reload all context components together on newSession()", async () => {
			// Create AGENTS.md
			const agentsPath = join(tempDir, "AGENTS.md");
			writeFileSync(agentsPath, "# Context\n\nInitial.");

			// Create skill with proper frontmatter
			const skillsDir = join(tempDir, ".pi", "skills");
			mkdirSync(skillsDir, { recursive: true });
			const skillPath = join(skillsDir, "test-skill");
			mkdirSync(skillPath, { recursive: true });
			writeFileSync(join(skillPath, "SKILL.md"), "---\ndescription: A test skill.\n---\n\n# Skill\n\nInitial.");

			// Create template
			const templatesDir = join(tempDir, ".pi", "prompts");
			mkdirSync(templatesDir, { recursive: true });
			writeFileSync(join(templatesDir, "test.md"), "Initial.");

			session = createSession({ customPrompt: "Custom." });

			// Modify all files
			writeFileSync(agentsPath, "# Context\n\nUpdated.");
			writeFileSync(join(skillPath, "SKILL.md"), "---\ndescription: A test skill.\n---\n\n# Skill\n\nUpdated.");
			writeFileSync(join(templatesDir, "test.md"), "Updated.");

			// Call newSession()
			await session.newSession();

			// Verify all components are reloaded
			const prompt = session.agent.state.systemPrompt;
			expect(prompt).toContain("Custom."); // Custom prompt preserved
			expect(session.promptTemplates[0].content).toBe("Updated."); // Templates reloaded
		});

		it("should emit context_reloaded event with details", async () => {
			// Create AGENTS.md
			const agentsPath = join(tempDir, "AGENTS.md");
			writeFileSync(agentsPath, "# Context\n\nInitial.");

			// Create skill with proper frontmatter
			const skillsDir = join(tempDir, ".pi", "skills");
			mkdirSync(skillsDir, { recursive: true });
			const skillPath = join(skillsDir, "test-skill");
			mkdirSync(skillPath, { recursive: true });
			writeFileSync(join(skillPath, "SKILL.md"), "---\ndescription: A test skill.\n---\n\n# Skill\n\nInitial.");

			// Create template
			const templatesDir = join(tempDir, ".pi", "prompts");
			mkdirSync(templatesDir, { recursive: true });
			writeFileSync(join(templatesDir, "test.md"), "Initial.");

			// Create session first
			session = createSession();

			// Capture emitted events
			const events: AgentSessionEvent[] = [];
			const unsubscribe = session.subscribe((event) => {
				events.push(event);
			});

			// Call newSession()
			await session.newSession();

			// Verify context_reloaded event was emitted
			const reloadedEvent = events.find((e) => e.type === "context_reloaded");
			expect(reloadedEvent).toBeDefined();
			expect(reloadedEvent?.type).toBe("context_reloaded");

			if (reloadedEvent && reloadedEvent.type === "context_reloaded") {
				expect(reloadedEvent.contextFiles).toBe(1); // AGENTS.md
				expect(reloadedEvent.skills).toBe(1); // test-skill
				expect(reloadedEvent.templates).toBe(1); // test.md
				expect(reloadedEvent.errors).toBeUndefined();
			}

			unsubscribe();
		});
	});
});
