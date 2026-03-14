import { beforeAll, describe, expect, test } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.js";
import { Header } from "../src/modes/interactive/components/header.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("Header component", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders something for large widths", () => {
		const header = new Header();
		const output = header.render(100);
		expect(output.length).toBeGreaterThan(1);
		// Check that it contains some ANSI escape codes for colors
		expect(output.some((line) => line.includes("\x1b["))).toBe(true);
	});

	test("renders micro fallback for small widths", () => {
		const header = new Header();
		const output = header.render(10);
		expect(output.length).toBeGreaterThan(0);
		expect(output.some((line) => line.includes("J"))).toBe(true);
	});

	test("uses the footer provider git metadata and session name", () => {
		const footerData: ReadonlyFooterDataProvider = {
			getAvailableProviderCount: () => 0,
			getExtensionStatuses: () => new Map(),
			getGitBranch: () => "feature/header-fix",
			getGitRepoName: () => "jensen-code",
			onBranchChange: () => () => {},
		};
		const session = { sessionName: "workspace-a" } as AgentSession;

		const output = new Header(session, footerData).render(120).join("\n");

		expect(output).toContain("jensen-code");
		expect(output).toContain("feature/header-fix");
		expect(output).toContain("workspace-a");
	});
});
