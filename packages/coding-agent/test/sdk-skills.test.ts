import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentSession, type ExtensionAPI } from "../src/core/sdk.js";
import { SessionManager } from "../src/core/session-manager.js";

describe("createAgentSession skills option", () => {
	let tempDir: string;
	let skillsDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-sdk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		skillsDir = join(tempDir, "skills", "test-skill");
		mkdirSync(skillsDir, { recursive: true });

		// Create a test skill in the pi skills directory
		writeFileSync(
			join(skillsDir, "SKILL.md"),
			`---
name: test-skill
description: A test skill for SDK tests.
---

# Test Skill

This is a test skill.
`,
		);
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("should discover skills by default and expose them on session.skills", async () => {
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
		});

		// Skills should be discovered and exposed on the session
		expect(session.skills.length).toBeGreaterThan(0);
		expect(session.skills.some((s) => s.name === "test-skill")).toBe(true);
	});

	it("should include skills from directories provided by skills_discover", async () => {
		const extraSkillsDir = join(tempDir, "extra-skills", "ext-skill");
		mkdirSync(extraSkillsDir, { recursive: true });
		writeFileSync(
			join(extraSkillsDir, "SKILL.md"),
			`---
name: ext-skill
description: A skill provided via skills_discover.
---

# Extension Skill

Loaded from skills_discover.
`,
		);

		let calls = 0;
		const extension = (pi: ExtensionAPI) => {
			pi.on("skills_discover", () => {
				calls += 1;
				return { additionalDirectories: [join(tempDir, "extra-skills")] };
			});
		};

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			extensions: [extension],
		});

		const extSkill = session.skills.find((skill) => skill.name === "ext-skill");
		expect(calls).toBe(1);
		expect(extSkill?.source).toBe("extension");
	});

	it("should not run skills_discover when skills are explicitly set", async () => {
		let calls = 0;
		const extension = (pi: ExtensionAPI) => {
			pi.on("skills_discover", () => {
				calls += 1;
				return { additionalDirectories: ["/unused"] };
			});
		};

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			skills: [],
			extensions: [extension],
		});

		expect(session.skills).toEqual([]);
		expect(calls).toBe(0);
	});

	it("should have empty skills when options.skills is empty array (--no-skills)", async () => {
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			skills: [], // Explicitly empty - like --no-skills
		});

		// session.skills should be empty
		expect(session.skills).toEqual([]);
		// No warnings since we didn't discover
		expect(session.skillWarnings).toEqual([]);
	});

	it("should use provided skills when options.skills is explicitly set", async () => {
		const customSkill = {
			name: "custom-skill",
			description: "A custom skill",
			filePath: "/fake/path/SKILL.md",
			baseDir: "/fake/path",
			source: "custom" as const,
		};

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			skills: [customSkill],
		});

		// session.skills should contain only the provided skill
		expect(session.skills).toEqual([customSkill]);
		// No warnings since we didn't discover
		expect(session.skillWarnings).toEqual([]);
	});
});
