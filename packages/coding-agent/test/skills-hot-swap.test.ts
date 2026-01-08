import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { createEventBus } from "../src/core/event-bus.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { diffSkills, loadSkills, type Skill, type SkillWarning } from "../src/core/skills.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createRng(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 48271) % 0x7fffffff;
		return state / 0x7fffffff;
	};
}

function randInt(rng: () => number, maxExclusive: number): number {
	return Math.floor(rng() * maxExclusive);
}

function makeSkill(name: string, index: number): Skill {
	return {
		name,
		description: `Skill ${name} ${index}`,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		source: "test",
	};
}

type SkillsChangedEvent = {
	skills: { added: string[]; removed: string[]; updated: string[]; warnings: SkillWarning[] };
};

describe("skills hot-swap", () => {
	it("diffSkills matches set relationships with randomized data", () => {
		const rng = createRng(1337);
		for (let i = 0; i < 100; i++) {
			const baseCount = randInt(rng, 12);
			const baseNames = Array.from({ length: baseCount }, (_unused, idx) => `skill-${i}-${idx}`);
			const before = baseNames.map((name, idx) => makeSkill(name, idx));

			const removed = new Set<string>();
			const updated = new Set<string>();
			const after: Skill[] = [];

			for (const skill of before) {
				if (rng() < 0.25) {
					removed.add(skill.name);
					continue;
				}

				let next = skill;
				if (rng() < 0.35) {
					next = { ...next, description: `${next.description} updated` };
					updated.add(skill.name);
				} else if (rng() < 0.1) {
					next = { ...next, filePath: `${next.filePath}.moved` };
					updated.add(skill.name);
				}
				after.push(next);
			}

			const added: Skill[] = [];
			const addedCount = randInt(rng, 6);
			for (let j = 0; j < addedCount; j++) {
				const name = `added-${i}-${j}`;
				added.push(makeSkill(name, j));
			}
			after.push(...added);

			const expectedAdded = added.map((s) => s.name).sort();
			const expectedRemoved = Array.from(removed).sort();
			const expectedUpdated = Array.from(updated).sort();

			const diff = diffSkills(before, after);
			expect(diff.added).toEqual(expectedAdded);
			expect(diff.removed).toEqual(expectedRemoved);
			expect(diff.updated).toEqual(expectedUpdated);
		}
	});

	describe("reloadSkills integration", () => {
		let tempDir: string;
		let session: AgentSession | undefined;

		beforeEach(() => {
			tempDir = mkdtempSync(join(tmpdir(), "pi-skills-hot-swap-"));
			mkdirSync(join(tempDir, "agent", "skills"), { recursive: true });
		});

		afterEach(() => {
			if (session) {
				session.dispose();
				session = undefined;
			}
			if (tempDir) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		it("records reload summary, emits event, and updates prompt", async () => {
			const skillsDir = join(tempDir, "agent", "skills");
			const alphaDir = join(skillsDir, "alpha");
			mkdirSync(alphaDir, { recursive: true });
			writeFileSync(join(alphaDir, "SKILL.md"), "---\nname: alpha\ndescription: Alpha skill.\n---\n\n# Alpha\n");

			const settingsManager = SettingsManager.inMemory({});
			const skillsSettings = {
				enabled: true,
				watch: false,
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: true,
				enablePiProject: false,
				customDirectories: [],
				ignoredSkills: [],
				includeSkills: [],
			};
			const loaded = loadSkills({ ...skillsSettings, cwd: tempDir, agentDir: join(tempDir, "agent") });
			const skillsState = { skills: loaded.skills };

			const model = getModel("anthropic", "claude-sonnet-4-5")!;
			const agent = new Agent({
				getApiKey: () => "test-key",
				initialState: {
					model,
					systemPrompt: `skills:${skillsState.skills.map((s) => s.name).join(",")}`,
					tools: [],
				},
				streamFn: () => {
					const stream = new MockAssistantStream();
					queueMicrotask(() => {
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("done") });
					});
					return stream;
				},
			});

			const sessionManager = SessionManager.inMemory();
			const authStorage = new AuthStorage(join(tempDir, "agent", "auth.json"));
			authStorage.setRuntimeApiKey("anthropic", "test-key");
			const modelRegistry = new ModelRegistry(authStorage, join(tempDir, "agent"));
			const eventBus = createEventBus();

			let lastEvent: SkillsChangedEvent | undefined;
			eventBus.on("skills:changed", (data) => {
				lastEvent = data as SkillsChangedEvent;
			});

			session = new AgentSession({
				agent,
				sessionManager,
				settingsManager,
				skillsSettings,
				skills: loaded.skills,
				skillWarnings: loaded.warnings,
				skillsState,
				skillsReloadEnabled: true,
				modelRegistry,
				rebuildSystemPrompt: () => `skills:${skillsState.skills.map((s) => s.name).join(",")}`,
				eventBus,
				cwd: tempDir,
				agentDir: join(tempDir, "agent"),
			});

			const betaDir = join(skillsDir, "beta");
			mkdirSync(betaDir, { recursive: true });
			writeFileSync(join(betaDir, "SKILL.md"), "---\nname: beta\ndescription: Beta skill.\n---\n\n# Beta\n");
			writeFileSync(
				join(alphaDir, "SKILL.md"),
				"---\nname: alpha\ndescription: Alpha skill updated.\n---\n\n# Alpha\n",
			);

			const summary = await session.reloadSkills("manual");
			expect(summary).not.toBeNull();
			expect(summary?.added).toEqual(["beta"]);
			expect(summary?.updated).toEqual(["alpha"]);
			expect(agent.state.systemPrompt).toContain("alpha");
			expect(agent.state.systemPrompt).toContain("beta");

			const entries = session.sessionManager.getEntries();
			const reloadEntries = entries.filter(
				(entry) => entry.type === "custom" && entry.customType === "skills_reload",
			);
			expect(reloadEntries).toHaveLength(1);

			expect(lastEvent).toBeDefined();
			if (!lastEvent) {
				throw new Error("Expected skills:changed event");
			}
			expect(lastEvent.skills.added).toEqual(["beta"]);
			expect(lastEvent.skills.updated).toEqual(["alpha"]);
			expect(lastEvent.skills.warnings).toEqual([]);
		});

		it("does not emit or record a reload entry when reload is a no-op", async () => {
			const skillsDir = join(tempDir, "agent", "skills");
			const alphaDir = join(skillsDir, "alpha");
			mkdirSync(alphaDir, { recursive: true });
			writeFileSync(join(alphaDir, "SKILL.md"), "---\nname: alpha\ndescription: Alpha skill.\n---\n\n# Alpha\n");

			const settingsManager = SettingsManager.inMemory({});
			const skillsSettings = {
				enabled: true,
				watch: false,
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: true,
				enablePiProject: false,
				customDirectories: [],
				ignoredSkills: [],
				includeSkills: [],
			};
			const loaded = loadSkills({ ...skillsSettings, cwd: tempDir, agentDir: join(tempDir, "agent") });
			const skillsState = { skills: loaded.skills };

			const model = getModel("anthropic", "claude-sonnet-4-5")!;
			const agent = new Agent({
				getApiKey: () => "test-key",
				initialState: {
					model,
					systemPrompt: `skills:${skillsState.skills.map((s) => s.name).join(",")}`,
					tools: [],
				},
				streamFn: () => {
					const stream = new MockAssistantStream();
					queueMicrotask(() => {
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("done") });
					});
					return stream;
				},
			});

			const sessionManager = SessionManager.inMemory();
			const authStorage = new AuthStorage(join(tempDir, "agent", "auth.json"));
			authStorage.setRuntimeApiKey("anthropic", "test-key");
			const modelRegistry = new ModelRegistry(authStorage, join(tempDir, "agent"));
			const eventBus = createEventBus();

			let eventCount = 0;
			eventBus.on("skills:changed", () => {
				eventCount++;
			});

			session = new AgentSession({
				agent,
				sessionManager,
				settingsManager,
				skillsSettings,
				skills: loaded.skills,
				skillWarnings: loaded.warnings,
				skillsState,
				skillsReloadEnabled: true,
				modelRegistry,
				rebuildSystemPrompt: () => `skills:${skillsState.skills.map((s) => s.name).join(",")}`,
				eventBus,
				cwd: tempDir,
				agentDir: join(tempDir, "agent"),
			});

			const summary = await session.reloadSkills("manual");
			expect(summary).not.toBeNull();
			expect(summary?.changed).toBe(false);
			expect(eventCount).toBe(0);

			const entries = session.sessionManager.getEntries();
			const reloadEntries = entries.filter(
				(entry) => entry.type === "custom" && entry.customType === "skills_reload",
			);
			expect(reloadEntries).toHaveLength(0);
		});
	});
});
