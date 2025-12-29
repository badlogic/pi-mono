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

const QNA_SYSTEM_PROMPT = `You are a text formatter that extracts questions from assistant messages and reformats them for user responses.

Given an assistant message, identify all questions or points that need user input/clarification.
Format them as a markdown document with:
- Numbered sections for each question/topic
- The original question in a blockquote
- An "**Answer:**" placeholder after each question

Rules:
- Preserve the original question text in blockquotes
- Group related sub-questions under one section
- Keep the formatting clean and scannable
- Only include actual questions or points needing input, not rhetorical questions
- If there are no questions, output exactly: "No questions found in the last message."

Example output:
## 1. Database Configuration

> What database should we use - PostgreSQL or SQLite?
> Do you need connection pooling?

**Answer:**

## 2. Authentication

> Should we use JWT or session-based auth?

**Answer:**`;

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

			if (formattedText.includes("No questions found")) {
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
