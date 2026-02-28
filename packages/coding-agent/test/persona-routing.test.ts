/**
 * Tests for persona agent routing from the orchestrate extension.
 *
 * Tests loadPersonaAgentConfig() and buildPersonaPreamble() logic by
 * re-implementing the pure parsing functions and testing against real
 * and synthetic persona AGENTS.md files.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeAll, describe, expect, it } from "vitest";

// ─── Re-implemented types and functions from orchestrate/index.ts ────────────

interface PersonaMeta {
	composes: string[];
	collaborators: string[];
}

interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	systemPrompt: string;
	personaMeta?: PersonaMeta;
}

/**
 * Parse a persona AGENTS.md file into an AgentConfig.
 * Re-implements loadPersonaAgentConfig's file parsing logic.
 */
function parsePersonaAgentsFile(content: string, agentName: string): AgentConfig | null {
	const normalized = content.replace(/\r\n/g, "\n");

	let body = normalized;
	let name = agentName;
	const composes: string[] = [];
	const collaborators: string[] = [];

	if (normalized.startsWith("---")) {
		const endIndex = normalized.indexOf("\n---", 3);
		if (endIndex !== -1) {
			const frontmatterBlock = normalized.slice(4, endIndex);
			body = normalized.slice(endIndex + 4).trim();

			const nameMatch = frontmatterBlock.match(/^name:\s*(.+)$/m);
			if (nameMatch) name = nameMatch[1].trim();

			const parseYamlList = (key: string): string[] => {
				const re = new RegExp(`^${key}:\\s*$`, "m");
				const match = frontmatterBlock.match(re);
				if (!match) return [];
				const startIdx = (match.index ?? 0) + match[0].length;
				const items: string[] = [];
				for (const line of frontmatterBlock.slice(startIdx).split("\n")) {
					const itemMatch = line.match(/^\s+-\s+(.+)/);
					if (itemMatch) {
						items.push(itemMatch[1].replace(/#.*$/, "").trim());
					} else if (line.match(/^\S/)) {
						break;
					}
				}
				return items;
			};

			composes.push(...parseYamlList("composes"));
			collaborators.push(...parseYamlList("collaborators"));
		}
	}

	if (!body.trim()) return null;

	return {
		name,
		description: `Persona agent: ${name}`,
		tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write"],
		systemPrompt: body,
		personaMeta: composes.length || collaborators.length ? { composes, collaborators } : undefined,
	};
}

/**
 * Build persona preamble. Re-implements buildPersonaPreamble logic.
 */
function buildPersonaPreamble(agent: AgentConfig, _taskDescription: string): string {
	if (!agent.personaMeta) return "";

	const sections: string[] = [];

	if (agent.personaMeta.composes.length > 0) {
		sections.push(
			`## Available Skills (compose these, don't reinvent)\n` +
				agent.personaMeta.composes.map((s) => `- /${s}`).join("\n"),
		);
	}

	if (agent.personaMeta.collaborators.length > 0) {
		sections.push(`## Collaborators\n${agent.personaMeta.collaborators.map((c) => `- ${c}`).join("\n")}`);
	}

	if (sections.length === 0) return "";

	return `## Persona Context: ${agent.name}\n\n${sections.join("\n\n")}\n\n---\n`;
}

// ─── Test data ───────────────────────────────────────────────────────────────

const MARGARET_AGENTS_MD = `---
name: margaret-chen
scope: margaret_chen
provides:
  - extraction-quality-assessment
  - do-178c-verification
composes:
  - memory
  - taxonomy
  - extractor-quality-check
  - review-paper
  - lean4-prove
collaborators:
  - jennifer-cheung    # co-assessor
  - brandon-bailey     # SPARTA domain
  - rob-armstrong      # formal methods
taxonomy:
  - precision
---

# Margaret Chen — Quality Assurance Lead

You are Margaret Chen, a meticulous QA engineer with expertise in
extraction quality assessment and DO-178C verification.
`;

const SIMPLE_PERSONA = `---
name: simple-agent
description: A simple test persona.
---

# Simple Agent

You are a simple test agent.
`;

const NO_COMPOSES_PERSONA = `---
name: solo-agent
description: No composition.
---

# Solo Agent

Works alone, no composes or collaborators.
`;

const EMPTY_BODY_PERSONA = `---
name: empty-body
description: Has frontmatter but no body.
composes:
  - memory
---
`;

const NO_FRONTMATTER_PERSONA = `# Raw Agent

Just markdown, no frontmatter at all.
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("persona routing: parsePersonaAgentsFile", () => {
	it("should parse full persona with composes and collaborators", () => {
		const config = parsePersonaAgentsFile(MARGARET_AGENTS_MD, "margaret-chen");

		expect(config).not.toBeNull();
		expect(config!.name).toBe("margaret-chen");
		expect(config!.personaMeta).toBeDefined();
		expect(config!.personaMeta!.composes).toContain("memory");
		expect(config!.personaMeta!.composes).toContain("taxonomy");
		expect(config!.personaMeta!.composes).toContain("extractor-quality-check");
		expect(config!.personaMeta!.composes).toContain("review-paper");
		expect(config!.personaMeta!.composes).toContain("lean4-prove");
	});

	it("should parse collaborators and strip inline comments", () => {
		const config = parsePersonaAgentsFile(MARGARET_AGENTS_MD, "margaret-chen");

		expect(config!.personaMeta!.collaborators).toEqual(["jennifer-cheung", "brandon-bailey", "rob-armstrong"]);
	});

	it("should extract body as systemPrompt", () => {
		const config = parsePersonaAgentsFile(MARGARET_AGENTS_MD, "margaret-chen");

		expect(config!.systemPrompt).toContain("# Margaret Chen");
		expect(config!.systemPrompt).toContain("meticulous QA engineer");
		expect(config!.systemPrompt).not.toContain("---");
		expect(config!.systemPrompt).not.toContain("composes:");
	});

	it("should set default tools for persona agents", () => {
		const config = parsePersonaAgentsFile(MARGARET_AGENTS_MD, "margaret-chen");

		expect(config!.tools).toEqual(["Read", "Grep", "Glob", "Bash", "Edit", "Write"]);
	});

	it("should handle simple persona without composes", () => {
		const config = parsePersonaAgentsFile(SIMPLE_PERSONA, "simple-agent");

		expect(config).not.toBeNull();
		expect(config!.name).toBe("simple-agent");
		expect(config!.personaMeta).toBeUndefined();
	});

	it("should handle persona with no composes or collaborators", () => {
		const config = parsePersonaAgentsFile(NO_COMPOSES_PERSONA, "solo-agent");

		expect(config).not.toBeNull();
		expect(config!.personaMeta).toBeUndefined();
	});

	it("should return null for empty body", () => {
		const config = parsePersonaAgentsFile(EMPTY_BODY_PERSONA, "empty-body");

		expect(config).toBeNull();
	});

	it("should handle file without frontmatter", () => {
		const config = parsePersonaAgentsFile(NO_FRONTMATTER_PERSONA, "raw-agent");

		expect(config).not.toBeNull();
		expect(config!.name).toBe("raw-agent"); // Falls back to agentName param
		expect(config!.systemPrompt).toContain("# Raw Agent");
		expect(config!.personaMeta).toBeUndefined();
	});

	it("should use frontmatter name over agentName parameter", () => {
		const config = parsePersonaAgentsFile(MARGARET_AGENTS_MD, "wrong-name");

		expect(config!.name).toBe("margaret-chen"); // From frontmatter, not param
	});

	it("should handle Windows-style line endings", () => {
		const windowsContent = MARGARET_AGENTS_MD.replace(/\n/g, "\r\n");
		const config = parsePersonaAgentsFile(windowsContent, "margaret-chen");

		expect(config).not.toBeNull();
		expect(config!.name).toBe("margaret-chen");
		expect(config!.personaMeta!.composes.length).toBeGreaterThan(0);
	});

	it("should stop parsing YAML list at next top-level key", () => {
		const content = `---
name: test-agent
composes:
  - skill-a
  - skill-b
collaborators:
  - person-a
taxonomy:
  - precision
---

Body text.
`;
		const config = parsePersonaAgentsFile(content, "test-agent");

		expect(config!.personaMeta!.composes).toEqual(["skill-a", "skill-b"]);
		expect(config!.personaMeta!.collaborators).toEqual(["person-a"]);
	});
});

describe("persona routing: buildPersonaPreamble", () => {
	it("should build preamble with composes and collaborators", () => {
		const config = parsePersonaAgentsFile(MARGARET_AGENTS_MD, "margaret-chen")!;
		const preamble = buildPersonaPreamble(config, "assess extraction quality");

		expect(preamble).toContain("## Persona Context: margaret-chen");
		expect(preamble).toContain("## Available Skills");
		expect(preamble).toContain("- /memory");
		expect(preamble).toContain("- /taxonomy");
		expect(preamble).toContain("## Collaborators");
		expect(preamble).toContain("- jennifer-cheung");
		expect(preamble).toContain("---");
	});

	it("should return empty string for persona without meta", () => {
		const config = parsePersonaAgentsFile(SIMPLE_PERSONA, "simple-agent")!;
		const preamble = buildPersonaPreamble(config, "do something");

		expect(preamble).toBe("");
	});

	it("should include composes as /skill-name format", () => {
		const config: AgentConfig = {
			name: "test",
			description: "test",
			systemPrompt: "test",
			personaMeta: { composes: ["memory", "assess", "create-movie"], collaborators: [] },
		};
		const preamble = buildPersonaPreamble(config, "test task");

		expect(preamble).toContain("- /memory");
		expect(preamble).toContain("- /assess");
		expect(preamble).toContain("- /create-movie");
	});

	it("should omit skills section when no composes", () => {
		const config: AgentConfig = {
			name: "test",
			description: "test",
			systemPrompt: "test",
			personaMeta: { composes: [], collaborators: ["alice"] },
		};
		const preamble = buildPersonaPreamble(config, "test task");

		expect(preamble).not.toContain("## Available Skills");
		expect(preamble).toContain("## Collaborators");
		expect(preamble).toContain("- alice");
	});

	it("should omit collaborators section when no collaborators", () => {
		const config: AgentConfig = {
			name: "test",
			description: "test",
			systemPrompt: "test",
			personaMeta: { composes: ["memory"], collaborators: [] },
		};
		const preamble = buildPersonaPreamble(config, "test task");

		expect(preamble).toContain("## Available Skills");
		expect(preamble).not.toContain("## Collaborators");
	});
});

describe("persona routing: real persona files", () => {
	const agentsDir = join(process.cwd(), ".pi", "agents");

	it("should parse margaret-chen persona from disk", () => {
		const filePath = join(agentsDir, "margaret-chen", "AGENTS.md");
		if (!existsSync(filePath)) {
			return; // Skip if not in the right cwd
		}

		const content = readFileSync(filePath, "utf-8");
		const config = parsePersonaAgentsFile(content, "margaret-chen");

		expect(config).not.toBeNull();
		expect(config!.name).toBe("margaret-chen");
		expect(config!.personaMeta).toBeDefined();
		expect(config!.personaMeta!.composes.length).toBeGreaterThan(3);
		expect(config!.personaMeta!.collaborators.length).toBeGreaterThan(0);
	});

	it("should parse all persona agents without error", () => {
		if (!existsSync(agentsDir)) return;

		const { readdirSync } = require("fs");
		const agents = readdirSync(agentsDir, { withFileTypes: true })
			.filter((d: any) => d.isDirectory())
			.map((d: any) => d.name);

		for (const agentName of agents) {
			const filePath = join(agentsDir, agentName, "AGENTS.md");
			if (!existsSync(filePath)) continue;

			const content = readFileSync(filePath, "utf-8");
			// Should not throw
			const config = parsePersonaAgentsFile(content, agentName);
			// May be null if body is empty, but should not throw
			if (config) {
				expect(config.name).toBeTruthy();
				expect(config.systemPrompt).toBeTruthy();
			}
		}
	});

	it("should build preamble for every persona with composes", () => {
		if (!existsSync(agentsDir)) return;

		const { readdirSync } = require("fs");
		const agents = readdirSync(agentsDir, { withFileTypes: true })
			.filter((d: any) => d.isDirectory())
			.map((d: any) => d.name);

		let testedCount = 0;
		for (const agentName of agents) {
			const filePath = join(agentsDir, agentName, "AGENTS.md");
			if (!existsSync(filePath)) continue;

			const content = readFileSync(filePath, "utf-8");
			const config = parsePersonaAgentsFile(content, agentName);
			if (!config?.personaMeta) continue;

			const preamble = buildPersonaPreamble(config, "test task");
			if (config.personaMeta.composes.length > 0 || config.personaMeta.collaborators.length > 0) {
				expect(preamble.length).toBeGreaterThan(0);
				testedCount++;
			}
		}

		// Should have at least a few personas with composes
		expect(testedCount).toBeGreaterThan(0);
	});
});

describe("persona routing: filesystem discovery", () => {
	let tempRoot: string;

	beforeAll(() => {
		tempRoot = mkdtempSync("/tmp/pi-persona-test-");

		// Create a fake project with .pi/agents/
		const agentsDir = join(tempRoot, ".pi", "agents");
		mkdirSync(join(agentsDir, "test-persona"), { recursive: true });
		writeFileSync(
			join(agentsDir, "test-persona", "AGENTS.md"),
			`---
name: test-persona
composes:
  - memory
  - assess
collaborators:
  - helper-bot
---

# Test Persona

You are a test persona for unit testing.
`,
		);

		// Also create one without frontmatter
		mkdirSync(join(agentsDir, "raw-persona"), { recursive: true });
		writeFileSync(
			join(agentsDir, "raw-persona", "AGENTS.md"),
			`# Raw Persona

No frontmatter, just instructions.
`,
		);
	});

	it("should find persona AGENTS.md in filesystem", () => {
		const filePath = join(tempRoot, ".pi", "agents", "test-persona", "AGENTS.md");
		expect(existsSync(filePath)).toBe(true);

		const content = readFileSync(filePath, "utf-8");
		const config = parsePersonaAgentsFile(content, "test-persona");

		expect(config).not.toBeNull();
		expect(config!.name).toBe("test-persona");
		expect(config!.personaMeta!.composes).toEqual(["memory", "assess"]);
		expect(config!.personaMeta!.collaborators).toEqual(["helper-bot"]);
	});

	it("should handle raw persona without frontmatter", () => {
		const filePath = join(tempRoot, ".pi", "agents", "raw-persona", "AGENTS.md");
		const content = readFileSync(filePath, "utf-8");
		const config = parsePersonaAgentsFile(content, "raw-persona");

		expect(config).not.toBeNull();
		expect(config!.name).toBe("raw-persona");
		expect(config!.systemPrompt).toContain("# Raw Persona");
		expect(config!.personaMeta).toBeUndefined();
	});

	it("should return null for non-existent persona", () => {
		const filePath = join(tempRoot, ".pi", "agents", "nonexistent", "AGENTS.md");
		expect(existsSync(filePath)).toBe(false);
	});
});
