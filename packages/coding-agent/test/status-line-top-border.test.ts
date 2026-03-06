import { stripVTControlCharacters } from "node:util";
import { beforeAll, describe, expect, test } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.js";
import { StatusLineComponent } from "../src/modes/interactive/components/status-line.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createSession(): AgentSession {
	return {
		state: {
			model: {
				id: "claude-3-7-sonnet-20250219",
				name: "Claude 3.7 Sonnet",
				provider: "anthropic",
				reasoning: true,
				contextWindow: 200_000,
			},
			thinkingLevel: "high",
			messages: [],
		},
		sessionManager: {
			getEntries: () => [],
			getSessionName: () => undefined,
			getSessionId: () => "session12345678",
		},
		getContextUsage: () => ({ percent: 12.5, contextWindow: 200_000 }),
		modelRegistry: {
			isUsingOAuth: () => false,
		},
		isStreaming: false,
	} as unknown as AgentSession;
}

function createFooterData(branch: string, availableProviderCount = 1): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => branch,
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => availableProviderCount,
		onBranchChange: () => () => {},
	};
}

describe("StatusLineComponent top border", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("keeps the main status line in the editor border by default", () => {
		const footerData = createFooterData("main", 2);

		const component = new StatusLineComponent(createSession(), footerData);
		const rendered = component.render(120);
		const topBorder = stripVTControlCharacters(component.getTopBorder(120).content);

		expect(rendered).toEqual([]);
		expect(topBorder).toContain("pi");
		expect(topBorder).toContain("anthropic:");
		expect(topBorder).toContain("main");
	});

	test("falls back to standalone rendering when top-border integration is unavailable", () => {
		const footerData = createFooterData("feature/footer");

		const component = new StatusLineComponent(createSession(), footerData);
		component.setRenderMainLineInBody(true);

		const rendered = component.render(120).map((line) => stripVTControlCharacters(line));

		expect(rendered[0]).toContain("feature/footer");
	});
});
