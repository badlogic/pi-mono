import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock, getShellConfigMock, getShellEnvMock } = vi.hoisted(() => ({
	spawnSyncMock: vi.fn(),
	getShellConfigMock: vi.fn(),
	getShellEnvMock: vi.fn(),
}));

vi.mock("child_process", () => ({
	spawnSync: spawnSyncMock,
}));

vi.mock("../src/utils/shell.js", () => ({
	getShellConfig: getShellConfigMock,
	getShellEnv: getShellEnvMock,
}));

describe("resolve-config-value", () => {
	let resolveConfigValue: (config: string) => string | undefined;
	let clearConfigValueCache: () => void;

	beforeEach(async () => {
		vi.resetModules();
		spawnSyncMock.mockReset();
		getShellConfigMock.mockReset();
		getShellEnvMock.mockReset();

		({ resolveConfigValue, clearConfigValueCache } = await import("../src/core/resolve-config-value.js"));
		clearConfigValueCache();
	});

	it("executes command values via the configured shell abstraction", () => {
		getShellConfigMock.mockReturnValue({ shell: "/custom/bash", args: ["-lc"] });
		getShellEnvMock.mockReturnValue({ PATH: "/custom/bin" });
		spawnSyncMock.mockReturnValue({ status: 0, stdout: "  shell-output  \n" });

		expect(resolveConfigValue("!echo shell-output")).toBe("shell-output");
		expect(getShellConfigMock).toHaveBeenCalledTimes(1);
		expect(getShellEnvMock).toHaveBeenCalledTimes(1);
		expect(spawnSyncMock).toHaveBeenCalledWith("/custom/bash", ["-lc", "echo shell-output"], {
			encoding: "utf-8",
			timeout: 10000,
			stdio: ["ignore", "pipe", "ignore"],
			env: { PATH: "/custom/bin" },
		});
	});
});
