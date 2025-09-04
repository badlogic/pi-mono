import { type Context, complete, getModel } from "../src/index.js";

async function testCrossProviderToolCall() {
	console.log("Testing cross-provider tool call handoff...\n");

	// Define a simple tool
	const tools = [
		{
			name: "get_weather",
			description: "Get current weather for a location",
			parameters: {
				type: "object",
				properties: {
					location: { type: "string", description: "City name" },
				},
				required: ["location"],
			},
		},
	];

	// Create context with tools
	const context: Context = {
		systemPrompt: "You are a helpful assistant. Use the get_weather tool when asked about weather.",
		messages: [{ role: "user", content: "What is the weather in Paris?" }],
		tools,
	};

	try {
		// Step 1: Get tool call from GPT-5
		console.log("Step 1: Getting tool call from GPT-5...");
		const gpt5 = getModel("openai", "gpt-5-mini");
		const gpt5Response = await complete(gpt5, context);
		context.messages.push(gpt5Response);

		// Check for tool calls
		const toolCalls = gpt5Response.content.filter((b) => b.type === "toolCall");
		console.log(`GPT-5 made ${toolCalls.length} tool call(s)`);

		if (toolCalls.length > 0) {
			const toolCall = toolCalls[0];
			console.log(`Tool call ID: ${toolCall.id}`);
			console.log(`Tool call contains pipe: ${toolCall.id.includes("|")}`);
			console.log(`Tool: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})\n`);

			// Add tool result
			context.messages.push({
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: JSON.stringify({
					location: "Paris",
					temperature: "22°C",
					conditions: "Partly cloudy",
				}),
				isError: false,
			});

			// Step 2: Send to Claude Haiku for follow-up
			console.log("Step 2: Sending to Claude Haiku for follow-up...");
			const haiku = getModel("anthropic", "claude-3-5-haiku-20241022");

			try {
				const haikuResponse = await complete(haiku, context);
				console.log("✅ Claude Haiku successfully processed the conversation!");
				console.log("Response content types:", haikuResponse.content.map((b) => b.type).join(", "));
				console.log("Number of content blocks:", haikuResponse.content.length);
				console.log("Stop reason:", haikuResponse.stopReason);
				if (haikuResponse.error) {
					console.log("Error message:", haikuResponse.error);
				}

				// Print all response content
				for (const block of haikuResponse.content) {
					if (block.type === "text") {
						console.log("\nClaude text response:", block.text);
					} else if (block.type === "thinking") {
						console.log("\nClaude thinking:", block.thinking);
					} else if (block.type === "toolCall") {
						console.log("\nClaude tool call:", block.name, block.arguments);
					}
				}

				if (haikuResponse.content.length === 0) {
					console.log("⚠️  Claude returned an empty response!");
				}
			} catch (error) {
				console.error("❌ Claude Haiku failed to process the conversation:");
				console.error("Error:", error);

				// Check if it's related to the tool call ID
				if (error instanceof Error && error.message.includes("tool")) {
					console.error("\n⚠️  This appears to be a tool call ID issue!");
					console.error("The pipe character (|) in OpenAI Response API tool IDs might be causing problems.");
				}
			}
		} else {
			console.log("No tool calls were made by GPT-5");
		}
	} catch (error) {
		console.error("Test failed:", error);
	}
}

// Set API keys from environment or pass them explicitly
const openaiKey = process.env.OPENAI_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!openaiKey || !anthropicKey) {
	console.error("Please set OPENAI_API_KEY and ANTHROPIC_API_KEY environment variables");
	process.exit(1);
}

testCrossProviderToolCall().catch(console.error);
