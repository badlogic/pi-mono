import { describe, expect, it } from "vitest";
import { execCommand } from "../src/core/exec.ts";

describe("execCommand", () => {
	// Regression test for https://github.com/earendil-works/pi/issues/11085
	it("reports spawn errors in stderr", async () => {
		const result = await execCommand("pi-command-that-does-not-exist-11085", [], process.cwd());

		expect(result).toMatchObject({
			code: 1,
			killed: false,
			stdout: "",
		});
		expect(result.stderr).toMatch(/ENOENT/);
	});

	it("keeps stderr empty when a command exits silently", async () => {
		const result = await execCommand(process.execPath, ["-e", "process.exit(1)"], process.cwd());

		expect(result).toEqual({ stdout: "", stderr: "", code: 1, killed: false });
	});

	// Regression test for https://github.com/earendil-works/pi/issues/11312
	it("decodes UTF-8 characters split across output chunks", async () => {
		const script = `
			const bytes = Buffer.from("你好", "utf8");
			const out = process.stdout;
			const err = process.stderr;
			out.write(bytes.subarray(0, 1));
			err.write(bytes.subarray(0, 2));
			setTimeout(() => {
				out.write(bytes.subarray(1));
				err.write(bytes.subarray(2));
			}, 100);
		`;
		const result = await execCommand(process.execPath, ["-e", script], process.cwd());

		expect(result).toEqual({ stdout: "你好", stderr: "你好", code: 0, killed: false });
	});
});
