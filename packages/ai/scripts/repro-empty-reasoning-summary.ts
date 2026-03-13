/**
 * Reproduction script: GPT-5 models intermittently return reasoning items
 * with encrypted_content but empty summary (summary: []).
 *
 * When replayed, these cause:
 *   400 "function_call was provided without its required reasoning item"
 *   400 "reasoning was provided without its required following item"
 *
 * Usage:
 *   AZURE_OPENAI_API_KEY=xxx AZURE_OPENAI_BASE_URL=https://xxx.openai.azure.com/openai/v1 \
 *     npx tsx packages/ai/scripts/repro-empty-reasoning-summary.ts
 *
 * Or with OpenAI directly:
 *   OPENAI_API_KEY=xxx npx tsx packages/ai/scripts/repro-empty-reasoning-summary.ts --openai
 */
import OpenAI, { AzureOpenAI } from "openai";

const useOpenAI = process.argv.includes("--openai");

function createClient() {
	if (useOpenAI) {
		return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
	}
	return new AzureOpenAI({
		apiKey: process.env.AZURE_OPENAI_API_KEY,
		apiVersion: "v1",
		baseURL: process.env.AZURE_OPENAI_BASE_URL,
	});
}

const client = createClient();
const MODEL = "gpt-5.3-codex";
const TOOLS: OpenAI.Responses.Tool[] = [
	{
		type: "function",
		name: "read",
		description: "Read a file",
		parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		strict: false,
	},
];

async function streamAndCollectItems(input: OpenAI.Responses.ResponseInput) {
	const stream = await client.responses.create({
		model: MODEL,
		input,
		stream: true,
		tools: TOOLS,
		reasoning: { effort: "medium", summary: "auto" },
		include: ["reasoning.encrypted_content"],
	});
	const items: OpenAI.Responses.ResponseOutputItem[] = [];
	for await (const event of stream) {
		if (event.type === "response.output_item.done") {
			items.push(event.item);
		}
	}
	return items;
}

async function main() {
	const MAX_ATTEMPTS = 10;
	console.log(`Attempting to reproduce empty reasoning summary (up to ${MAX_ATTEMPTS} tries)...\n`);

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const items = await streamAndCollectItems([
			{ role: "developer", content: "You are a coding assistant. Use the read tool." },
			{ role: "user", content: [{ type: "input_text", text: "hi, tell me about this project" }] },
		]);

		const emptyReasoning = items.filter(
			(i) => i.type === "reasoning" && (!i.summary || i.summary.length === 0),
		);
		const validReasoning = items.filter(
			(i) => i.type === "reasoning" && i.summary && i.summary.length > 0,
		);
		const funcCalls = items.filter((i) => i.type === "function_call");

		const status = emptyReasoning.length > 0 ? "EMPTY SUMMARY" : "ok";
		console.log(
			`  [${attempt}/${MAX_ATTEMPTS}] ${status} — ` +
				`${validReasoning.length} valid reasoning, ${emptyReasoning.length} empty reasoning, ${funcCalls.length} function_calls`,
		);

		if (emptyReasoning.length === 0) continue;

		// Found empty reasoning — now demonstrate the replay failure
		console.log("\n=== Reproducing replay failure ===\n");

		const fc = funcCalls[0] as OpenAI.Responses.ResponseFunctionToolCall;
		const replayInput: OpenAI.Responses.ResponseInput = [
			{ role: "developer", content: "You are a coding assistant." },
			{ role: "user", content: [{ type: "input_text", text: "hi" }] },
			...items, // replay all items including empty reasoning
			{ type: "function_call_output", call_id: fc.call_id, output: "file content here" },
		];

		try {
			await streamAndCollectItems(replayInput);
			console.log("  Replay succeeded (unexpected)");
		} catch (err: any) {
			console.log(`  Replay failed: ${err.message}`);
			if (err.message.includes("400")) {
				console.log("\n  CONFIRMED: Empty reasoning summary causes 400 on replay.");
				console.log(`  Empty reasoning item: id=${emptyReasoning[0].id}`);
				console.log(`  summary: ${JSON.stringify((emptyReasoning[0] as any).summary)}`);
				console.log(`  has encrypted_content: ${!!(emptyReasoning[0] as any).encrypted_content}`);
			}
		}
		return;
	}

	console.log(`\nDid not reproduce in ${MAX_ATTEMPTS} attempts (intermittent ~40% rate on Azure).`);
}

main().catch(console.error);
