import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface SubagentTurnReportEntry {
	version: 1;
	kind: "first_activity" | "tool_progress" | "turn" | "agent_end";
	turnIndex: number;
	text: string;
	toolCount: number;
	timestamp: number;
}

const SUBAGENT_TURN_REPORT_TYPE = "subagent-turn-report";
const MAX_REPORT_TEXT_CHARS = 12_000;

function truncateWithEllipsis(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 3)}...`;
}

function extractTextFromMessage(message: AgentMessage | undefined): string {
	if (!message) return "";
	if (!("content" in message)) return "";
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function findLastAssistantMessage(messages: AgentMessage[]): AgentMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "assistant") return messages[i];
	}
	return undefined;
}

export default function (pi: ExtensionAPI): void {
	let currentTurnIndex = 0;
	let currentTurnToolCount = 0;
	let totalToolCount = 0;
	let firstActivityReported = false;

	const appendReport = (
		kind: "first_activity" | "tool_progress" | "turn" | "agent_end",
		turnIndex: number,
		text: string,
	): void => {
		const report: SubagentTurnReportEntry = {
			version: 1,
			kind,
			turnIndex,
			text: truncateWithEllipsis(text, MAX_REPORT_TEXT_CHARS),
			toolCount: totalToolCount,
			timestamp: Date.now(),
		};
		pi.appendEntry(SUBAGENT_TURN_REPORT_TYPE, report);
	};

	const reportFirstActivity = (text: string): void => {
		if (firstActivityReported) return;
		firstActivityReported = true;
		appendReport("first_activity", currentTurnIndex, text);
	};

	pi.on("turn_start", async (event) => {
		currentTurnIndex = event.turnIndex;
		currentTurnToolCount = 0;
	});

	pi.on("tool_execution_end", async () => {
		currentTurnToolCount++;
		totalToolCount++;
		reportFirstActivity("[tool_execution_end]");
		appendReport("tool_progress", currentTurnIndex, "[tool_execution_end]");
	});

	pi.on("tool_execution_start", async () => {
		reportFirstActivity("[tool_execution_start]");
	});

	pi.on("message_update", async (event) => {
		if (event.message.role !== "assistant") return;
		const assistantEvent = event.assistantMessageEvent;
		if (assistantEvent.type === "text_delta" && assistantEvent.delta.trim().length > 0) {
			reportFirstActivity(assistantEvent.delta);
		}
	});

	pi.on("turn_end", async (event) => {
		if (event.message.role !== "assistant") return;
		const text = extractTextFromMessage(event.message);
		if (text.trim().length > 0) {
			reportFirstActivity(text);
		}
		appendReport("turn", event.turnIndex, text);
	});

	pi.on("agent_end", async (event) => {
		const lastAssistant = findLastAssistantMessage(event.messages);
		appendReport("agent_end", currentTurnIndex, extractTextFromMessage(lastAssistant));
	});
}
