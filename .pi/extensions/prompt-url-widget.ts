import { DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";

const PR_PROMPT_PATTERN = /^You are given one or more GitHub PR URLs:\s*(\S+)/im;
const ISSUE_PROMPT_PATTERN = /^Analyze GitHub issue\(s\):\s*(\S+)/im;

type PromptMatch = {
	kind: "pr" | "issue";
	url: string;
};

type GhMetadata = {
	title?: string;
	author?: {
		login?: string;
		name?: string | null;
	};
};

function extractPromptMatch(prompt: string): PromptMatch | undefined {
	const prMatch = prompt.match(PR_PROMPT_PATTERN);
	if (prMatch?.[1]) {
		return { kind: "pr", url: prMatch[1].trim() };
	}

	const issueMatch = prompt.match(ISSUE_PROMPT_PATTERN);
	if (issueMatch?.[1]) {
		return { kind: "issue", url: issueMatch[1].trim() };
	}

	return undefined;
}

async function fetchGhMetadata(
	pi: ExtensionAPI,
	kind: PromptMatch["kind"],
	url: string,
): Promise<GhMetadata | undefined> {
	const args =
		kind === "pr" ? ["pr", "view", url, "--json", "title,author"] : ["issue", "view", url, "--json", "title,author"];

	try {
		const result = await pi.exec("gh", args);
		if (result.code !== 0 || !result.stdout) return undefined;
		return JSON.parse(result.stdout) as GhMetadata;
	} catch {
		return undefined;
	}
}

function formatAuthor(author?: GhMetadata["author"]): string | undefined {
	if (!author) return undefined;
	const name = author.name?.trim();
	const login = author.login?.trim();
	if (name && login) return `${name} (@${login})`;
	if (login) return `@${login}`;
	if (name) return name;
	return undefined;
}

export default function promptUrlWidgetExtension(pi: ExtensionAPI) {
	const setWidget = (ctx: ExtensionContext, match: PromptMatch, title?: string, authorText?: string) => {
		ctx.ui.setWidget("prompt-url", (_tui, thm) => {
			const titleText = title ? thm.fg("accent", title) : thm.fg("accent", match.url);
			const authorLine = authorText ? thm.fg("muted", authorText) : undefined;
			const urlLine = thm.fg("dim", match.url);

			const lines = [titleText];
			if (authorLine) lines.push(authorLine);
			lines.push(urlLine);

			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => thm.fg("muted", s)));
			container.addChild(new Text(lines.join("\n"), 1, 0));
			return container;
		});
	};

	pi.on("before_agent_start", async (event, ctx) => {
		if (!ctx.hasUI) return;
		const match = extractPromptMatch(event.prompt);
		if (!match) {
			ctx.ui.setWidget("prompt-url", undefined);
			return;
		}

		setWidget(ctx, match);
		void fetchGhMetadata(pi, match.kind, match.url).then((meta) => {
			const title = meta?.title?.trim();
			const authorText = formatAuthor(meta?.author);
			setWidget(ctx, match, title, authorText);
		});
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		const entries = ctx.sessionManager.getEntries();
		const lastUser = [...entries].reverse().find((entry) => {
			return entry.type === "message" && entry.message.role === "user";
		});

		const content = lastUser?.type === "message" && lastUser?.message.role === "user" ? lastUser.message.content : undefined;
		const text =
			typeof content === "string"
				? content
				: content
						?.filter((block): block is { type: "text"; text: string } => block.type === "text")
						.map((block) => block.text)
						.join("\n") ?? "";

		const match = text ? extractPromptMatch(text) : undefined;
		if (!match) {
			ctx.ui.setWidget("prompt-url", undefined);
			return;
		}

		setWidget(ctx, match);
		void fetchGhMetadata(pi, match.kind, match.url).then((meta) => {
			const title = meta?.title?.trim();
			const authorText = formatAuthor(meta?.author);
			setWidget(ctx, match, title, authorText);
		});
	});
}
