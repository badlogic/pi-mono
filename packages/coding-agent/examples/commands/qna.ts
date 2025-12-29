/**
 * Q&A Command - Extract questions from the last agent message and format them for answering
 *
 * This command takes the last assistant message, extracts any questions the agent asked,
 * and reformats them into a markdown document that the user can fill in.
 * The result is loaded into the editor so the user can answer the questions.
 *
 * Usage:
 *   Symlink to ~/.pi/agent/commands/qna.ts
 *   Then type: /qna
 *   Or: /qna claude-3-5-sonnet-latest (to use a different model)
 *
 * Uses claude-haiku-4-5 by default for fast transformation.
 */

import type { ScriptCommandFactory } from "@mariozechner/pi-coding-agent";

const QNA_SYSTEM_PROMPT = `You extract questions from text and reformat them for easy answering.

TASK: Find ALL questions, decision points, or items needing user input in the given text. Format each as a numbered section with the question in a blockquote and an "Answer:" placeholder.

Look for:
- Direct questions (sentences ending with ?)
- Numbered lists asking for choices or decisions
- Bullet points requesting input or clarification
- "Should we...", "Do you want...", "Which..." patterns
- Options labeled (a), (b), (c) etc.

Output format (no title/header, start directly with the first section):
## 1. [Topic]

> [Original question text]

Answer:

## 2. [Topic]

> [Original question text]

Answer:

IMPORTANT: Be thorough. If the text contains ANY questions or decision points, extract them. Only output "NO_QUESTIONS_FOUND" (exactly this, nothing else) if the text truly contains zero questions or points needing input.`;

const command: ScriptCommandFactory = (pi) => ({
	description: "Extract questions from last message into editor",

	async execute(args) {
		const model = args[0] || "claude-haiku-4-5";

		// Get the last assistant message
		const lastText = pi.getLastAssistantText();
		if (!lastText) {
			pi.showError("No assistant messages to extract questions from.");
			return;
		}

		pi.showStatus(`Extracting questions using ${model}...`);

		try {
			// Use the complete API to transform the message
			const result = await pi.complete(lastText, {
				model,
				systemPrompt: QNA_SYSTEM_PROMPT,
				maxTokens: 4096,
			});

			// Extract text from result
			let formattedText = "";
			for (const content of result.content) {
				if (content.type === "text") {
					formattedText += content.text;
				}
			}

			if (!formattedText.trim()) {
				pi.showError("No output from model.");
				return;
			}

			if (formattedText.trim() === "NO_QUESTIONS_FOUND") {
				pi.showStatus("No questions found in the last message.");
				return;
			}

			// Put the formatted questions in the editor
			pi.setEditorText(formattedText.trim());
			pi.showStatus("Questions extracted. Press Ctrl+G to edit in external editor, or edit inline.");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			pi.showError(`Failed to extract questions: ${message}`);
		}
	},
});

export default command;
