import { z } from "zod";
import type { Tool, ToolCall } from "./types.js";

/**
 * Validates tool call arguments against the tool's Zod schema
 * @param tool The tool definition with Zod schema
 * @param toolCall The tool call from the LLM
 * @returns The validated arguments
 * @throws ZodError with formatted message if validation fails
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
	try {
		// Validate arguments with Zod schema
		return tool.parameters.parse(toolCall.arguments);
	} catch (e) {
		if (e instanceof z.ZodError) {
			// Format validation errors nicely
			const errors = e.issues
				.map((err) => {
					const path = err.path.length > 0 ? err.path.join(".") : "root";
					return `  - ${path}: ${err.message}`;
				})
				.join("\n");

			const errorMessage = `Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n${JSON.stringify(toolCall.arguments, null, 2)}`;

			// Throw a new error with the formatted message
			throw new Error(errorMessage);
		}
		throw e;
	}
}
