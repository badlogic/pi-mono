import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadModule() {
	vi.resetModules();
	return import("../src/utils/tools-manager.js");
}

describe("tools-manager", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		process.env = { ...ORIGINAL_ENV };
	});

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	it("returns existing PATH tool without fetching releases", async () => {
		const fetchSpy = vi.fn();
		const { ensureTool } = await loadModule();
		const result = await ensureTool("fd", true, {
			spawnSync: vi.fn().mockReturnValue({ status: 0, error: undefined }),
			fetch: fetchSpy as any,
			createWriteStream: vi.fn() as any,
			existsSync: vi.fn().mockReturnValue(false),
			mkdirSync: vi.fn() as any,
			readdirSync: vi.fn() as any,
			renameSync: vi.fn() as any,
			rmSync: vi.fn() as any,
			chmodSync: vi.fn() as any,
		});

		expect(result).toBe("fd");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("reports missing release asset with install hint instead of attempting blind download", async () => {
		const logs: string[] = [];
		vi.spyOn(console, "log").mockImplementation((...args) => {
			logs.push(args.join(" "));
		});

		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/repos/sharkdp/fd/releases/latest")) {
				return new Response(JSON.stringify({ tag_name: "v10.4.0", assets: [] }), { status: 200 });
			}
			if (url.includes("/repos/sharkdp/fd/releases/tags/v10.4.0")) {
				return new Response(JSON.stringify({ assets: [] }), { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});

		const createWriteStreamMock = vi.fn();
		const { ensureTool } = await loadModule();
		const result = await ensureTool("fd", false, {
			spawnSync: vi.fn().mockReturnValue({ status: null, error: { message: "spawn fd ENOENT" } }),
			fetch: fetchMock as any,
			createWriteStream: createWriteStreamMock as any,
			existsSync: vi.fn().mockReturnValue(false),
			mkdirSync: vi.fn() as any,
			readdirSync: vi.fn().mockReturnValue([]) as any,
			renameSync: vi.fn() as any,
			rmSync: vi.fn() as any,
			chmodSync: vi.fn() as any,
		});

		expect(result).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(createWriteStreamMock).not.toHaveBeenCalled();
		expect(logs.some((line) => line.includes("fd not found. Downloading..."))).toBe(true);
		expect(
			logs.some((line) =>
				line.includes("Release asset not found for sharkdp/fd@v10.4.0: fd-v10.4.0-aarch64-apple-darwin.tar.gz"),
			),
		).toBe(true);
		expect(logs.some((line) => line.includes("brew install fd"))).toBe(true);
	});
});
