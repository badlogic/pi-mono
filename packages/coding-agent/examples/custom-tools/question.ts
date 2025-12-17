/**
 * Question Tool - Let the LLM ask the user a question with options
 */

import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import type { CustomAgentTool, CustomToolFactory } from "@mariozechner/pi-coding-agent";

interface QuestionDetails {
	question: string;
	options: string[];
	answer: string | null;
}

const QuestionParams = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	options: Type.Array(Type.String(), { description: "Options for the user to choose from" }),
});

const factory: CustomToolFactory = (pi) => {
	const tool: CustomAgentTool<typeof QuestionParams, QuestionDetails> = {
		name: "question",
		label: "Question",
		description: "Ask the user a question and let them pick from options. Use when you need user input to proceed.",
		parameters: QuestionParams,

		async execute(_toolCallId, params) {
			if (!pi.hasUI) {
				return {
					content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
					details: { question: params.question, options: params.options, answer: null },
				};
			}

			if (params.options.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No options provided" }],
					details: { question: params.question, options: [], answer: null },
				};
			}

			const answer = await pi.ui.select(params.question, params.options);

			if (answer === null) {
				return {
					content: [{ type: "text", text: "User cancelled the selection" }],
					details: { question: params.question, options: params.options, answer: null },
				};
			}

			return {
				content: [{ type: "text", text: `User selected: ${answer}` }],
				details: { question: params.question, options: params.options, answer },
			};
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("question ")) + theme.fg("muted", args.question);
			if (args.options?.length) {
				text += "\n" + theme.fg("dim", `  Options: ${args.options.join(", ")}`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const { details } = result;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.answer === null) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}

			return new Text(theme.fg("success", "✓ ") + theme.fg("accent", details.answer), 0, 0);
		},
	};

	return tool;
};

export default factory;
