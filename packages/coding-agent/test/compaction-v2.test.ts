/**
 * Tests for Structured Summary V2 and Anchored Iterative Summarization.
 *
 * These tests verify:
 * - Artifact index extraction from tool calls with frequency tracking
 * - Structured summary parsing and serialization
 * - V1 to V2 conversion for backward compatibility
 * - Summary version detection
 */

import type { AppMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolCall, Usage } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
	type ArtifactIndex,
	artifactIndexToMarkdown,
	convertV1ToV2Summary,
	createEmptyArtifactIndex,
	createEmptyStructuredSummary,
	extractArtifactIndex,
	type FileRecord,
	isV2Summary,
	mergeArtifactIndices,
	parseArtifactIndexFromMarkdown,
	parseStructuredSummaryFromMarkdown,
	type StructuredSummaryV2,
	SUMMARY_V2_MARKER,
	structuredSummaryToMarkdown,
} from "../src/core/compaction.js";

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockUsage(input = 100, output = 50, cacheRead = 0, cacheWrite = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createAssistantMessage(text: string, toolCalls?: ToolCall[], usage?: Usage): AssistantMessage {
	const content: AssistantMessage["content"] = [{ type: "text", text }];
	if (toolCalls) {
		content.push(...toolCalls);
	}
	return {
		role: "assistant",
		content,
		usage: usage || createMockUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
	};
}

function createToolCall(name: string, args: Record<string, unknown>): ToolCall {
	return {
		type: "toolCall",
		id: `call_${Math.random().toString(36).slice(2)}`,
		name,
		arguments: args,
	};
}

function fr(path: string, count = 1): FileRecord {
	return { path, count };
}

// ============================================================================
// Artifact Index Tests
// ============================================================================

describe("Artifact Index - Extraction", () => {
	it("should extract file reads from tool calls with frequency", () => {
		const messages: AppMessage[] = [
			createAssistantMessage("Reading files", [
				createToolCall("read", { path: "package.json" }),
				createToolCall("read", { path: "tsconfig.json" }),
				createToolCall("read", { path: "package.json" }), // Second read of same file
			]),
		];

		const index = extractArtifactIndex(messages);
		expect(index.filesRead).toHaveLength(2);
		expect(index.filesRead).toContainEqual(fr("package.json", 2));
		expect(index.filesRead).toContainEqual(fr("tsconfig.json", 1));
	});

	it("should extract file modifications from edit tool calls", () => {
		const messages: AppMessage[] = [
			createAssistantMessage("Editing file", [createToolCall("edit", { path: "src/app.ts" })]),
		];

		const index = extractArtifactIndex(messages);
		expect(index.filesModified).toContainEqual(fr("src/app.ts", 1));
	});

	it("should extract file creations from write tool calls", () => {
		const messages: AppMessage[] = [
			createAssistantMessage("Creating file", [createToolCall("write", { path: "src/new.ts", content: "..." })]),
		];

		const index = extractArtifactIndex(messages);
		expect(index.filesCreated).toContainEqual(fr("src/new.ts", 1));
	});

	it("should merge file frequencies correctly", () => {
		const index1: ArtifactIndex = {
			...createEmptyArtifactIndex(),
			filesRead: [fr("src/a.ts", 2), fr("src/b.ts", 1)],
		};
		const index2: ArtifactIndex = {
			...createEmptyArtifactIndex(),
			filesRead: [fr("src/b.ts", 3), fr("src/c.ts", 1)],
		};

		const merged = mergeArtifactIndices(index1, index2);
		expect(merged.filesRead).toContainEqual(fr("src/a.ts", 2));
		expect(merged.filesRead).toContainEqual(fr("src/b.ts", 4)); // 1 + 3
		expect(merged.filesRead).toContainEqual(fr("src/c.ts", 1));
	});

	it("should track true recency with LRU ordering", () => {
		const messages: AppMessage[] = [
			createAssistantMessage("Reading files", [
				createToolCall("read", { path: "src/first.ts" }),
				createToolCall("read", { path: "src/second.ts" }),
				createToolCall("read", { path: "src/first.ts" }), // Access first.ts again - should move to end
			]),
		];

		const index = extractArtifactIndex(messages);
		// first.ts should now be at the end due to LRU ordering
		expect(index.filesRead).toHaveLength(2);
		expect(index.filesRead[0].path).toBe("src/second.ts");
		expect(index.filesRead[1].path).toBe("src/first.ts");
		expect(index.filesRead[1].count).toBe(2);
	});

	it("should deduplicate bash commands from tool calls and bashExecution messages", () => {
		// Same command appears in both tool call and bashExecution message
		// This happens because bashExecution is a streaming message for the same bash tool call
		const bashToolCall = createToolCall("bash", { command: "npm test" });
		const messages: AppMessage[] = [
			createAssistantMessage("Running tests", [bashToolCall]),
			// bashExecution message for the same command (with richer data)
			{
				role: "bashExecution",
				command: "npm test",
				output: "All tests passed",
				exitCode: 0,
				timestamp: Date.now(),
			} as AppMessage,
		];

		const index = extractArtifactIndex(messages);

		// Should only have one entry for "npm test", not two
		expect(index.commandsRun).toHaveLength(1);
		expect(index.commandsRun[0].cmd).toBe("npm test");
		// Should prefer the richer data from bashExecution when available
		expect(index.commandsRun[0].exitCode).toBe(0);
	});

	it("should track different bash commands separately", () => {
		const messages: AppMessage[] = [
			createAssistantMessage("Running commands", [
				createToolCall("bash", { command: "npm test" }),
				createToolCall("bash", { command: "npm run build" }),
			]),
		];

		const index = extractArtifactIndex(messages);
		expect(index.commandsRun).toHaveLength(2);
		expect(index.commandsRun.map((c) => c.cmd)).toContain("npm test");
		expect(index.commandsRun.map((c) => c.cmd)).toContain("npm run build");
	});

	it("should extract custom tool calls to toolCalls array", () => {
		const messages: AppMessage[] = [
			createAssistantMessage("Using custom tools", [
				createToolCall("codemap", { path: "src/", seed: "auth login" }),
				createToolCall("subagent", { agent: "worker", task: "Review code" }),
			]),
		];

		const index = extractArtifactIndex(messages);
		expect(index.toolCalls).toHaveLength(2);
		expect(index.toolCalls[0].name).toBe("codemap");
		expect(index.toolCalls[0].params).toContain("path=src/");
		expect(index.toolCalls[1].name).toBe("subagent");
	});
});

describe("Artifact Index - Merge", () => {
	it("should merge artifact indices preserving order with recency", () => {
		const index1: ArtifactIndex = {
			filesRead: [fr("src/a.ts", 2), fr("src/b.ts", 1)],
			filesModified: [],
			filesCreated: [],
			commandsRun: [{ cmd: "npm test" }],
			toolCalls: [{ name: "codemap", params: "path=src/" }],
			tests: [{ cmd: "vitest", result: "pass" }],
		};

		const index2: ArtifactIndex = {
			filesRead: [fr("src/b.ts", 3), fr("src/c.ts", 1)], // b.ts appears again - should move to end
			filesModified: [fr("src/a.ts", 1)],
			filesCreated: [fr("src/new.ts", 1)],
			commandsRun: [{ cmd: "npm run build" }],
			toolCalls: [{ name: "subagent", params: "agent=worker" }],
			tests: [{ cmd: "vitest", result: "fail", failures: ["test 1"] }],
		};

		const merged = mergeArtifactIndices(index1, index2);

		// File frequencies should be summed
		expect(merged.filesRead).toContainEqual(fr("src/a.ts", 2));
		expect(merged.filesRead).toContainEqual(fr("src/b.ts", 4)); // 1 + 3
		expect(merged.filesRead).toContainEqual(fr("src/c.ts", 1));

		// b.ts should be at the end due to recency (it was accessed in index2)
		const bIndex = merged.filesRead.findIndex((f) => f.path === "src/b.ts");
		const cIndex = merged.filesRead.findIndex((f) => f.path === "src/c.ts");
		expect(bIndex).toBeLessThan(cIndex); // b comes before c because c was added after b moved

		// Other arrays should be concatenated
		expect(merged.commandsRun).toHaveLength(2);
		expect(merged.toolCalls).toHaveLength(2);
		expect(merged.tests).toHaveLength(2);
		expect(merged.filesModified).toHaveLength(1);
		expect(merged.filesCreated).toHaveLength(1);
	});
});

describe("Artifact Index - Serialization", () => {
	it("should serialize artifact index to markdown with frequency annotations", () => {
		const index: ArtifactIndex = {
			filesRead: [fr("src/a.ts", 5), fr("src/b.ts", 1)],
			filesModified: [fr("src/c.ts", 2)],
			filesCreated: [fr("src/d.ts", 1)],
			commandsRun: [{ cmd: "npm test", exitCode: 0 }],
			toolCalls: [],
			tests: [{ cmd: "vitest", result: "pass" }],
		};

		const markdown = artifactIndexToMarkdown(index);

		expect(markdown).toContain("**Files Read:**");
		expect(markdown).toContain("src/a.ts (5x)");
		expect(markdown).toContain("src/b.ts");
		expect(markdown).toContain("**Files Modified:**");
		expect(markdown).toContain("src/c.ts (2x)");
		expect(markdown).toContain("**Commands Run:**");
		expect(markdown).toContain("`npm test`");
	});

	it("should parse artifact index from markdown with frequency annotations", () => {
		// Note: Tests are no longer parsed from artifact index - they're in the main summary's ## Tests section
		const markdown = `**Files Read:**
- src/file1.ts (3x)
- src/file2.ts (recent)

**Files Modified:**
- src/modified.ts (2x)

**Commands Run:**
- \`npm test\` (2x)
- \`npm run check\` (recent exit 0)
`;

		const parsed = parseArtifactIndexFromMarkdown(markdown);
		expect(parsed).not.toBeNull();
		expect(parsed!.filesRead).toContainEqual(fr("src/file1.ts", 3));
		expect(parsed!.filesRead).toContainEqual(fr("src/file2.ts", 1));
		expect(parsed!.filesModified).toContainEqual(fr("src/modified.ts", 2));

		expect(parsed!.commandsRun).toContainEqual({ cmd: "npm test", exitCode: undefined });
		expect(parsed!.commandsRun).toContainEqual({ cmd: "npm run check", exitCode: 0 });

		// Tests are not parsed from artifact index (they come from ## Tests section in main summary)
		expect(parsed!.tests).toEqual([]);
	});

	it("should roundtrip artifact index through markdown", () => {
		const original: ArtifactIndex = {
			filesRead: [fr("path/to/file.ts", 2)],
			filesModified: [fr("path/to/modified.ts", 1)],
			filesCreated: [fr("path/to/created.ts", 1)],
			commandsRun: [],
			toolCalls: [],
			tests: [],
		};

		const markdown = artifactIndexToMarkdown(original);
		const parsed = parseArtifactIndexFromMarkdown(markdown);

		expect(parsed).not.toBeNull();
		// Paths should match (frequency may differ due to formatting)
		expect(parsed!.filesRead.map((f) => f.path)).toEqual(original.filesRead.map((f) => f.path));
		expect(parsed!.filesModified.map((f) => f.path)).toEqual(original.filesModified.map((f) => f.path));
		expect(parsed!.filesCreated.map((f) => f.path)).toEqual(original.filesCreated.map((f) => f.path));
	});
});

// ============================================================================
// Structured Summary V2 Tests
// ============================================================================

describe("Structured Summary V2 - Version Detection", () => {
	it("should detect v2 summary by marker", () => {
		const v2Summary = `${SUMMARY_V2_MARKER}

## Session Intent
- Build a CLI tool
`;
		expect(isV2Summary(v2Summary)).toBe(true);
	});

	it("should not detect v1 summary as v2", () => {
		const v1Summary = `This is a plain text summary of the session.
The user was building a CLI tool.`;
		expect(isV2Summary(v1Summary)).toBe(false);
	});
});

describe("Structured Summary V2 - Serialization", () => {
	it("should serialize empty summary correctly", () => {
		const summary = createEmptyStructuredSummary();
		const markdown = structuredSummaryToMarkdown(summary);

		expect(markdown).toContain(SUMMARY_V2_MARKER);
		expect(markdown).toContain("## Session Intent");
		expect(markdown).toContain("## Constraints & Preferences");
		expect(markdown).toContain("## Current State");
		expect(markdown).toContain("### Done");
		expect(markdown).toContain("### In Progress");
		expect(markdown).toContain("### Blocked");
		expect(markdown).toContain("## Artifact Index");
		expect(markdown).toContain("## Errors / Issues");
		expect(markdown).toContain("## Decisions");
		expect(markdown).toContain("## Next Steps");
		expect(markdown).toContain("## Open Questions");
		expect(markdown).toContain("## Dead Ends / Do-Not-Repeat");
	});

	it("should serialize populated summary correctly", () => {
		const summary: StructuredSummaryV2 = {
			version: 2,
			sessionIntent: ["Build a REST API", "Add authentication"],
			constraintsAndPreferences: ["Use TypeScript", "Follow REST conventions"],
			currentState: {
				done: ["Set up project structure", "Implement user model"],
				inProgress: ["Add JWT authentication"],
				blocked: ["Waiting for database credentials"],
			},
			artifactIndex: {
				filesRead: [fr("src/index.ts", 1)],
				filesModified: [fr("src/auth.ts", 2)],
				filesCreated: [fr("src/models/user.ts", 1)],
				commandsRun: [{ cmd: "npm test", exitCode: 0 }],
				toolCalls: [],
				tests: [],
			},
			decisions: [{ decision: "Use JWT", rationale: "Industry standard for stateless auth" }],
			nextSteps: ["Complete auth middleware", "Add protected routes"],
			openQuestions: ["Which database to use?"],
			deadEnds: ["Tried session-based auth but too complex"],
			errors: ["TypeError: Cannot read property 'id' of undefined"],
			tests: [{ cmd: "npm test", result: "pass" }],
		};

		const markdown = structuredSummaryToMarkdown(summary);

		expect(markdown).toContain("- Build a REST API");
		expect(markdown).toContain("- Add authentication");
		expect(markdown).toContain("- Use TypeScript");
		expect(markdown).toContain("- [x] Set up project structure");
		expect(markdown).toContain("- [ ] Add JWT authentication");
		expect(markdown).toContain("- ⚠ Waiting for database credentials");
		expect(markdown).toContain("**Use JWT**: Industry standard");
		expect(markdown).toContain("1. Complete auth middleware");
		expect(markdown).toContain("- Which database to use?");
		expect(markdown).toContain("- Tried session-based auth");
		expect(markdown).toContain("- TypeError: Cannot read property");
	});
});

describe("Structured Summary V2 - Parsing", () => {
	it("should parse v2 summary from markdown", () => {
		const markdown = `${SUMMARY_V2_MARKER}

## Session Intent
- Build a CLI tool
- Add file watching

## Constraints & Preferences
- Use Node.js
- Prefer async/await

## Current State
### Done
- [x] Initial setup

### In Progress
- [ ] File watcher implementation

### Blocked
- ⚠ Missing permissions

## Artifact Index
**Files Read:**
- src/index.ts (2x)

**Files Modified:**
- src/watcher.ts

## Errors / Issues
- Failed to read config file

## Decisions
- **Use chokidar**: Best cross-platform file watcher

## Next Steps
1. Complete watcher
2. Add CLI args

## Open Questions
- How to handle symlinks?

## Dead Ends / Do-Not-Repeat
- Native fs.watch too limited
`;

		const parsed = parseStructuredSummaryFromMarkdown(markdown);

		expect(parsed).not.toBeNull();
		expect(parsed!.version).toBe(2);
		expect(parsed!.sessionIntent).toContain("Build a CLI tool");
		expect(parsed!.sessionIntent).toContain("Add file watching");
		expect(parsed!.constraintsAndPreferences).toContain("Use Node.js");
		expect(parsed!.currentState.done).toContain("Initial setup");
		expect(parsed!.currentState.inProgress).toContain("File watcher implementation");
		expect(parsed!.currentState.blocked).toContain("Missing permissions");
		expect(parsed!.artifactIndex.filesRead.map((f) => f.path)).toContain("src/index.ts");
		expect(parsed!.artifactIndex.filesModified.map((f) => f.path)).toContain("src/watcher.ts");
		expect(parsed!.decisions.length).toBe(1);
		expect(parsed!.decisions[0].decision).toBe("Use chokidar");
		expect(parsed!.nextSteps).toContain("Complete watcher");
		expect(parsed!.openQuestions).toContain("How to handle symlinks?");
		expect(parsed!.deadEnds).toContain("Native fs.watch too limited");
		expect(parsed!.errors).toContain("Failed to read config file");
	});

	it("should return null for non-v2 summary", () => {
		const v1Summary = "This is a plain text summary.";
		const parsed = parseStructuredSummaryFromMarkdown(v1Summary);
		expect(parsed).toBeNull();
	});

	it("should roundtrip summary through markdown", () => {
		const original: StructuredSummaryV2 = {
			version: 2,
			sessionIntent: ["Main goal"],
			constraintsAndPreferences: ["Constraint 1"],
			currentState: {
				done: ["Task 1"],
				inProgress: ["Task 2"],
				blocked: ["Blocker 1"],
			},
			artifactIndex: {
				filesRead: [fr("file1.ts", 1)],
				filesModified: [fr("file2.ts", 1)],
				filesCreated: [fr("file3.ts", 1)],
				commandsRun: [],
				toolCalls: [],
				tests: [],
			},
			decisions: [{ decision: "Decision 1", rationale: "Reason 1" }],
			nextSteps: ["Next 1", "Next 2"],
			openQuestions: ["Question 1"],
			deadEnds: ["Dead end 1"],
			errors: ["Error 1"],
			tests: [{ cmd: "npm test", result: "pass" }],
		};

		const markdown = structuredSummaryToMarkdown(original);
		const parsed = parseStructuredSummaryFromMarkdown(markdown);

		expect(parsed).not.toBeNull();
		expect(parsed!.sessionIntent).toEqual(original.sessionIntent);
		expect(parsed!.constraintsAndPreferences).toEqual(original.constraintsAndPreferences);
		expect(parsed!.currentState.done).toEqual(original.currentState.done);
		expect(parsed!.currentState.inProgress).toEqual(original.currentState.inProgress);
		expect(parsed!.currentState.blocked).toEqual(original.currentState.blocked);
		expect(parsed!.decisions).toEqual(original.decisions);
		expect(parsed!.nextSteps).toEqual(original.nextSteps);
		expect(parsed!.openQuestions).toEqual(original.openQuestions);
		expect(parsed!.deadEnds).toEqual(original.deadEnds);
		expect(parsed!.errors).toEqual(original.errors);
	});

	it("should parse decisions with empty rationale", () => {
		const markdown = `${SUMMARY_V2_MARKER}

## Decisions
- **Use TypeScript**: Great for type safety
- **Skip tests**:

## Session Intent
- Test empty rationale

## Constraints & Preferences
(none)

## Current State
### Done
(none)
### In Progress
(none)
### Blocked
(none)

## Artifact Index
**Files Read:**
(none)
**Files Modified:**
(none)
**Files Created:**
(none)

## Errors / Issues
(none)

## Next Steps
1. Done

## Open Questions
(none)

## Dead Ends / Do-Not-Repeat
(none)
`;

		const parsed = parseStructuredSummaryFromMarkdown(markdown);
		expect(parsed).not.toBeNull();
		expect(parsed!.decisions.length).toBe(2);
		expect(parsed!.decisions[0].decision).toBe("Use TypeScript");
		expect(parsed!.decisions[0].rationale).toBe("Great for type safety");
		expect(parsed!.decisions[1].decision).toBe("Skip tests");
		expect(parsed!.decisions[1].rationale).toBe("");
	});
});

describe("V1 to V2 Conversion", () => {
	it("should convert plain v1 summary to v2", () => {
		const v1Summary = `The user is building a REST API with authentication.
We've set up the project structure and are working on JWT tokens.`;

		const v2 = convertV1ToV2Summary(v1Summary);

		expect(v2.version).toBe(2);
		expect(v2.sessionIntent.length).toBeGreaterThan(0);
		// Content should be preserved somewhere
		expect(JSON.stringify(v2)).toContain("REST API");
	});

	it("should extract structured info from bullet-pointed v1 summary", () => {
		const v1Summary = `## Summary

- User goal: Build CLI tool
- Constraint: Use TypeScript

### Done
- Project setup
- Basic commands

### Next steps
1. Add file watching
2. Add tests`;

		const v2 = convertV1ToV2Summary(v1Summary);

		expect(v2.version).toBe(2);
		// Should attempt to extract structure
		expect(v2.nextSteps.length).toBeGreaterThan(0);
	});
});
