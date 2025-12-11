/**
 * CLI tool to test different compaction strategies on session fixtures.
 *
 * Usage:
 *   npx tsx test/compaction-strategies.ts [fixture-name]
 *
 * Examples:
 *   npx tsx test/compaction-strategies.ts large-session
 *   npx tsx test/compaction-strategies.ts before-compaction
 *
 * Output:
 *   test/compaction-results/[fixture]-[strategy].md
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { complete, getModel, type UserMessage } from "@mariozechner/pi-ai";

// ============================================================================
// Types
// ============================================================================

interface SessionEntry {
	type: string;
	timestamp: string;
	message?: {
		role: string;
		content: unknown;
		stopReason?: string;
	};
}

interface SimpleMessage {
	role: "user" | "assistant";
	content: string;
	tokens: number; // estimated
}

interface SliceSummary {
	sliceIndex: number;
	summary: string;
	tokens: number;
}

interface StrategyResult {
	name: string;
	summary: string;
	totalInputTokens: number;
	totalOutputTokens: number;
	numCalls: number;
	timeMs: number;
}

// ============================================================================
// Config
// ============================================================================

const MODEL = getModel("anthropic", "claude-sonnet-4-5");
const SLICE_TOKENS = 10000; // target tokens per slice (smaller for testing)
const SUMMARY_BUDGET = 2000; // max tokens for each summary call
const FINAL_SUMMARY_BUDGET = 4000; // max tokens for final/stitched summary

// ============================================================================
// Utilities
// ============================================================================

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				if (typeof block === "string") return block;
				if (block.type === "text") return block.text || "";
				if (block.type === "tool_use")
					return `[Tool: ${block.name}]\n${JSON.stringify(block.arguments || block.input, null, 2)}`;
				if (block.type === "tool_result") {
					const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
					return `[Tool Result: ${block.tool_use_id}]\n${text.slice(0, 2000)}${text.length > 2000 ? "..." : ""}`;
				}
				if (block.type === "thinking") return `[Thinking]\n${block.thinking}`;
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return JSON.stringify(content);
}

function loadSession(fixturePath: string): SimpleMessage[] {
	const content = fs.readFileSync(fixturePath, "utf-8");
	const lines = content.trim().split("\n");
	const messages: SimpleMessage[] = [];

	for (const line of lines) {
		try {
			const entry: SessionEntry = JSON.parse(line);
			if (entry.type === "message" && entry.message) {
				const role = entry.message.role;
				if (role !== "user" && role !== "assistant") continue;
				if (entry.message.stopReason === "aborted" || entry.message.stopReason === "error") continue;

				const text = extractTextContent(entry.message.content);
				if (!text.trim()) continue;

				messages.push({
					role: role as "user" | "assistant",
					content: text,
					tokens: estimateTokens(text),
				});
			}
		} catch {
			// skip malformed lines
		}
	}

	return messages;
}

function segmentByTokens(messages: SimpleMessage[], sliceTokens: number): SimpleMessage[][] {
	const slices: SimpleMessage[][] = [];
	let current: SimpleMessage[] = [];
	let currentTokens = 0;

	for (const msg of messages) {
		if (currentTokens + msg.tokens > sliceTokens && current.length > 0) {
			slices.push(current);
			current = [];
			currentTokens = 0;
		}
		current.push(msg);
		currentTokens += msg.tokens;
	}

	if (current.length > 0) {
		slices.push(current);
	}

	return slices;
}

function messagesToTranscript(messages: SimpleMessage[]): string {
	return messages
		.map((m) => {
			const prefix = m.role === "user" ? "USER:" : "ASSISTANT:";
			return `${prefix}\n${m.content}`;
		})
		.join("\n\n---\n\n");
}

async function callLLM(
	systemPrompt: string,
	userPrompt: string,
	maxTokens: number,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

	const messages: UserMessage[] = [
		{
			role: "user",
			content: userPrompt,
			timestamp: Date.now(),
		},
	];

	const result = await complete(
		MODEL,
		{
			system: systemPrompt,
			messages,
		},
		{
			maxTokens,
			apiKey,
		},
	);

	const text = result.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return {
		text,
		inputTokens: result.usage.input + result.usage.cacheRead,
		outputTokens: result.usage.output,
	};
}

// ============================================================================
// Strategy 1: Single-shot (current approach)
// ============================================================================

const SINGLE_SHOT_SYSTEM = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- Absolute file paths of any relevant files that were read or modified
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

async function strategySingleShot(messages: SimpleMessage[]): Promise<StrategyResult> {
	const start = Date.now();
	const transcript = messagesToTranscript(messages);

	const { text, inputTokens, outputTokens } = await callLLM(
		SINGLE_SHOT_SYSTEM,
		`Here is the conversation to summarize:\n\n<conversation>\n${transcript}\n</conversation>\n\nProvide your summary now:`,
		FINAL_SUMMARY_BUDGET,
	);

	return {
		name: "single-shot",
		summary: text,
		totalInputTokens: inputTokens,
		totalOutputTokens: outputTokens,
		numCalls: 1,
		timeMs: Date.now() - start,
	};
}

// ============================================================================
// Strategy 2: Parallel slices with LLM stitch
// ============================================================================

const SLICE_SYSTEM = `You are summarizing one segment of a longer coding session.
Be concise but capture key information: user requests, files modified, decisions made, errors fixed.
Preserve file paths and important code snippets.`;

const STITCH_SYSTEM = `You are combining multiple chronological summaries of a coding session into one coherent handoff document.
Remove redundancy. Preserve all file paths and key details. Emphasize the most recent work (last segment).`;

async function strategyParallelStitch(messages: SimpleMessage[]): Promise<StrategyResult> {
	const start = Date.now();
	const slices = segmentByTokens(messages, SLICE_TOKENS);
	let totalInput = 0;
	let totalOutput = 0;

	console.log(`  Parallel: ${slices.length} slices`);

	// Summarize all slices in parallel
	const sliceSummaries = await Promise.all(
		slices.map(async (slice, i) => {
			const isLast = i === slices.length - 1;
			const transcript = messagesToTranscript(slice);
			const prompt = `Segment ${i + 1} of ${slices.length}${isLast ? " (MOST RECENT)" : ""}:

${transcript}

${isLast ? "This is the most recent activity. Be detailed about current state and next steps." : "Summarize the key points from this segment."}`;

			const { text, inputTokens, outputTokens } = await callLLM(SLICE_SYSTEM, prompt, SUMMARY_BUDGET);
			totalInput += inputTokens;
			totalOutput += outputTokens;

			return { sliceIndex: i, summary: text, tokens: estimateTokens(text) };
		}),
	);

	// Stitch summaries together
	const stitchPrompt = sliceSummaries.map((s) => `=== Segment ${s.sliceIndex + 1} ===\n${s.summary}`).join("\n\n");

	const {
		text: finalSummary,
		inputTokens,
		outputTokens,
	} = await callLLM(
		STITCH_SYSTEM,
		`Combine these ${sliceSummaries.length} chronological segment summaries into one unified handoff summary:\n\n${stitchPrompt}`,
		FINAL_SUMMARY_BUDGET,
	);
	totalInput += inputTokens;
	totalOutput += outputTokens;

	return {
		name: "parallel-stitch",
		summary: finalSummary,
		totalInputTokens: totalInput,
		totalOutputTokens: totalOutput,
		numCalls: slices.length + 1,
		timeMs: Date.now() - start,
	};
}

// ============================================================================
// Strategy 3: Sequential slices with accumulated context
// ============================================================================

const SEQUENTIAL_SYSTEM = `You are summarizing one segment of a longer coding session.
You may be given summaries of earlier segments for context.
Create a summary of THIS segment's content. Do not repeat information from previous summaries.
Be concise but capture: user requests, files modified, decisions made, errors fixed.`;

async function strategySequentialAccumulated(messages: SimpleMessage[]): Promise<StrategyResult> {
	const start = Date.now();
	const slices = segmentByTokens(messages, SLICE_TOKENS);
	let totalInput = 0;
	let totalOutput = 0;

	console.log(`  Sequential: ${slices.length} slices`);

	const sliceSummaries: SliceSummary[] = [];

	for (let i = 0; i < slices.length; i++) {
		const slice = slices[i];
		const isLast = i === slices.length - 1;
		const transcript = messagesToTranscript(slice);

		// Build context from previous summaries
		const previousContext =
			sliceSummaries.length > 0
				? `Previous segments summary:\n${sliceSummaries.map((s) => `[Segment ${s.sliceIndex + 1}] ${s.summary}`).join("\n\n")}\n\n---\n\n`
				: "";

		const prompt = `${previousContext}Current segment (${i + 1} of ${slices.length})${isLast ? " - MOST RECENT" : ""}:

${transcript}

${isLast ? "This is the most recent activity. Be detailed about current state, pending work, and next steps." : "Summarize the key NEW information from this segment (don't repeat what's in previous summaries)."}`;

		const { text, inputTokens, outputTokens } = await callLLM(
			SEQUENTIAL_SYSTEM,
			prompt,
			isLast ? FINAL_SUMMARY_BUDGET : SUMMARY_BUDGET,
		);
		totalInput += inputTokens;
		totalOutput += outputTokens;

		sliceSummaries.push({
			sliceIndex: i,
			summary: text,
			tokens: estimateTokens(text),
		});

		console.log(`    Slice ${i + 1}/${slices.length} done`);
	}

	// Combine all slice summaries into final output
	const finalSummary = sliceSummaries.map((s) => `## Segment ${s.sliceIndex + 1}\n\n${s.summary}`).join("\n\n---\n\n");

	return {
		name: "sequential-accumulated",
		summary: finalSummary,
		totalInputTokens: totalInput,
		totalOutputTokens: totalOutput,
		numCalls: slices.length,
		timeMs: Date.now() - start,
	};
}

// ============================================================================
// Strategy 4: Sequential with rolling summary
// ============================================================================

const ROLLING_SYSTEM = `You are creating a rolling summary of a coding session.
Given a previous summary and new conversation content, produce an UPDATED summary that incorporates the new information.
Keep the summary focused and under the token budget. Condense older details as needed to make room for recent work.`;

async function strategySequentialRolling(messages: SimpleMessage[]): Promise<StrategyResult> {
	const start = Date.now();
	const slices = segmentByTokens(messages, SLICE_TOKENS);
	let totalInput = 0;
	let totalOutput = 0;

	console.log(`  Rolling: ${slices.length} slices`);

	let runningSummary = "";

	for (let i = 0; i < slices.length; i++) {
		const slice = slices[i];
		const isLast = i === slices.length - 1;
		const transcript = messagesToTranscript(slice);

		const prompt = runningSummary
			? `Current summary so far:\n${runningSummary}\n\n---\n\nNew content (segment ${i + 1} of ${slices.length}):\n${transcript}\n\n${isLast ? "This is the final segment. Produce the complete handoff summary with emphasis on current state and next steps." : "Update the summary to incorporate this new content. Condense older details if needed."}`
			: `First segment of the conversation:\n${transcript}\n\nCreate an initial summary capturing the key points.`;

		const { text, inputTokens, outputTokens } = await callLLM(
			ROLLING_SYSTEM,
			prompt,
			isLast ? FINAL_SUMMARY_BUDGET : SUMMARY_BUDGET,
		);
		totalInput += inputTokens;
		totalOutput += outputTokens;

		runningSummary = text;
		console.log(`    Slice ${i + 1}/${slices.length} done`);
	}

	return {
		name: "sequential-rolling",
		summary: runningSummary,
		totalInputTokens: totalInput,
		totalOutputTokens: totalOutput,
		numCalls: slices.length,
		timeMs: Date.now() - start,
	};
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	const fixtureName = process.argv[2] || "large-session";
	const fixturesDir = path.join(__dirname, "fixtures");
	const fixturePath = path.join(fixturesDir, `${fixtureName}.jsonl`);

	if (!fs.existsSync(fixturePath)) {
		console.error(`Fixture not found: ${fixturePath}`);
		console.error(`Available fixtures:`);
		for (const f of fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".jsonl"))) {
			console.error(`  - ${f.replace(".jsonl", "")}`);
		}
		process.exit(1);
	}

	console.log(`Loading fixture: ${fixtureName}`);
	const messages = loadSession(fixturePath);
	const totalTokens = messages.reduce((sum, m) => sum + m.tokens, 0);
	console.log(`  ${messages.length} messages, ~${totalTokens} tokens\n`);

	const resultsDir = path.join(__dirname, "compaction-results");
	fs.mkdirSync(resultsDir, { recursive: true });

	const strategies: Array<{
		name: string;
		fn: (msgs: SimpleMessage[]) => Promise<StrategyResult>;
	}> = [
		{ name: "single-shot", fn: strategySingleShot },
		{ name: "parallel-stitch", fn: strategyParallelStitch },
		{ name: "sequential-accumulated", fn: strategySequentialAccumulated },
		{ name: "sequential-rolling", fn: strategySequentialRolling },
	];

	const results: StrategyResult[] = [];

	for (const strategy of strategies) {
		console.log(`Running strategy: ${strategy.name}`);
		try {
			const result = await strategy.fn(messages);
			results.push(result);

			// Write individual result
			const outputPath = path.join(resultsDir, `${fixtureName}-${strategy.name}.md`);
			const output = `# Compaction Result: ${strategy.name}

## Stats
- Input tokens: ${result.totalInputTokens}
- Output tokens: ${result.totalOutputTokens}
- API calls: ${result.numCalls}
- Time: ${result.timeMs}ms

## Summary

${result.summary}
`;
			fs.writeFileSync(outputPath, output);
			console.log(`  ✓ Wrote ${outputPath}\n`);
		} catch (err) {
			console.error(`  ✗ Failed: ${err}\n`);
		}
	}

	// Write comparison summary
	const comparisonPath = path.join(resultsDir, `${fixtureName}-comparison.md`);
	const comparison = `# Compaction Strategy Comparison: ${fixtureName}

## Input
- Messages: ${messages.length}
- Estimated tokens: ${totalTokens}

## Results

| Strategy | Input Tokens | Output Tokens | API Calls | Time (ms) |
|----------|-------------|---------------|-----------|-----------|
${results.map((r) => `| ${r.name} | ${r.totalInputTokens} | ${r.totalOutputTokens} | ${r.numCalls} | ${r.timeMs} |`).join("\n")}

## Summaries

${results.map((r) => `### ${r.name}\n\n${r.summary}\n`).join("\n---\n\n")}
`;
	fs.writeFileSync(comparisonPath, comparison);
	console.log(`Wrote comparison: ${comparisonPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
