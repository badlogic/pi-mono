#!/usr/bin/env tsx
/**
 * Count tokens in system prompts using Anthropic's token counter API
 */

import * as prompts from "../src/prompts/prompts.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
	console.error("Error: ANTHROPIC_API_KEY environment variable not set");
	process.exit(1);
}

interface TokenCountResponse {
	input_tokens: number;
}

async function countTokens(text: string): Promise<number> {
	const response = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": ANTHROPIC_API_KEY,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: "claude-3-5-sonnet-20241022",
			messages: [
				{
					role: "user",
					content: text,
				},
			],
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`API error: ${response.status} ${error}`);
	}

	const data = (await response.json()) as TokenCountResponse;
	return data.input_tokens;
}

async function main() {
	console.log("Counting tokens in prompts...\n");

	const promptsToCount: Array<{ name: string; content: string }> = [
		{
			name: "ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION_RW",
			content: prompts.ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION_RW,
		},
		{
			name: "ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION_RO",
			content: prompts.ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION_RO,
		},
		{
			name: "ATTACHMENTS_RUNTIME_DESCRIPTION",
			content: prompts.ATTACHMENTS_RUNTIME_DESCRIPTION,
		},
		{
			name: "JAVASCRIPT_REPL_TOOL_DESCRIPTION (without runtime providers)",
			content: prompts.JAVASCRIPT_REPL_TOOL_DESCRIPTION([]),
		},
		{
			name: "ARTIFACTS_TOOL_DESCRIPTION (without runtime providers)",
			content: prompts.ARTIFACTS_TOOL_DESCRIPTION([]),
		},
	];

	let total = 0;

	for (const prompt of promptsToCount) {
		try {
			const tokens = await countTokens(prompt.content);
			total += tokens;
			console.log(`${prompt.name}: ${tokens.toLocaleString()} tokens`);
		} catch (error) {
			console.error(`Error counting tokens for ${prompt.name}:`, error);
		}
	}

	console.log(`\nTotal: ${total.toLocaleString()} tokens`);
}

main();
