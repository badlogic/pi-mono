import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { Tool, ToolCall } from "./types.js";

// Create a singleton AJV instance with formats
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

/**
 * Validates tool call arguments against the tool's TypeBox schema
 * @param tool The tool definition with TypeBox schema
 * @param toolCall The tool call from the LLM
 * @returns The validated arguments
 * @throws Error with formatted message if validation fails
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
	// Compile the schema
	const validate = ajv.compile(tool.parameters);

	// Validate the arguments
	if (validate(toolCall.arguments)) {
		return toolCall.arguments;
	}

	// Format validation errors nicely
	const errors =
		validate.errors
			?.map((err) => {
				const path = err.instancePath ? err.instancePath.substring(1) : err.params.missingProperty || "root";
				return `  - ${path}: ${err.message}`;
			})
			.join("\n") || "Unknown validation error";

	const errorMessage = `Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n${JSON.stringify(toolCall.arguments, null, 2)}`;

	throw new Error(errorMessage);
}
