import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import * as sessionServices from "../src/core/agent-session-services.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../src/core/trust-manager.ts";
import { main } from "../src/main.ts";

describe("main project trust", () => {
	let tempDir: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(process.cwd(), ".main-project-trust-"));
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(cwd);
		mkdirSync(agentDir);
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		vi.stubEnv(ENV_AGENT_DIR, agentDir);
		vi.stubEnv("PI_OFFLINE", "1");
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network request")));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		rmSync(tempDir, { recursive: true, force: true });
	});

	// Regression tests for #10947. Exercise createRuntime in main, without creating model services.
	it.each([
		{ savedDecision: false, expected: false },
		{ savedDecision: true, expected: true },
		{ savedDecision: null, expected: true },
	])("uses saved decision $savedDecision without project resources", async ({ savedDecision, expected }) => {
		new ProjectTrustStore(agentDir).set(cwd, savedDecision);
		expect(hasTrustRequiringProjectResources(cwd)).toBe(false);
		const stop = new Error("Stop before model services");
		const createServices = vi.spyOn(sessionServices, "createAgentSessionServices").mockRejectedValue(stop);

		await expect(main(["--help"])).rejects.toBe(stop);

		const options = createServices.mock.calls[0][0];
		expect(options.settingsManager?.isProjectTrusted()).toBe(expected);
		expect(options.resourceLoaderReloadOptions).toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
	});

	// Regression test for #10947: saved decisions must not bypass deferred resolution.
	it.each([null, false, true])("defers trust resolution with resources and saved decision %s", async (decision) => {
		new ProjectTrustStore(agentDir).set(cwd, decision);
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, ".pi", "settings.json"), "{}");
		expect(hasTrustRequiringProjectResources(cwd)).toBe(true);
		const getTrust = vi.spyOn(ProjectTrustStore.prototype, "get");
		const stop = new Error("Stop before model services");
		const createServices = vi.spyOn(sessionServices, "createAgentSessionServices").mockRejectedValue(stop);

		await expect(main(["--help"])).rejects.toBe(stop);

		const options = createServices.mock.calls[0][0];
		expect(options.settingsManager?.isProjectTrusted()).toBe(false);
		expect(options.resourceLoaderReloadOptions?.resolveProjectTrust).toBeTypeOf("function");
		expect(getTrust).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});
});
