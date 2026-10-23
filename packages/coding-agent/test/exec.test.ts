import * as childProcess from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { execCommand } from "../src/core/exec.ts";

const childProcessMocks = vi.hoisted(() => ({
	spawn: vi.fn<typeof childProcess.spawn>(),
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof childProcess>();
	childProcessMocks.spawn.mockImplementation(actual.spawn);
	return { ...actual, spawn: childProcessMocks.spawn };
});

describe("execCommand", () => {
	function mockChild() {
		const child = Object.assign(new childProcess.ChildProcess(), {
			stdout: new PassThrough(),
			stderr: new PassThrough(),
		});
		childProcessMocks.spawn.mockReturnValueOnce(child);
		return child;
	}

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

	// Like #433, pi.exec() must preserve characters split across output chunks.
	it.each(["stdout", "stderr"] as const)("decodes UTF-8 split across %s chunks", async (stream) => {
		const child = mockChild();
		const execution = execCommand("utf8-test", [], process.cwd());
		const text = "你好𠮷";
		const bytes = Buffer.from(text);

		// Split both the first three-byte character and the final four-byte character.
		child[stream].write(bytes.subarray(0, 1));
		child[stream].write(bytes.subarray(1, 8));
		child[stream].write(bytes.subarray(8));
		child.emit("close", 0);

		expect(await execution).toEqual({ stdout: "", stderr: "", [stream]: text, code: 0, killed: false });
	});

	it("keeps interleaved stdout and stderr decoding independent", async () => {
		const child = mockChild();
		const execution = execCommand("utf8-test", [], process.cwd());
		const stdout = Buffer.from("你好");
		const stderr = Buffer.from("世界");

		child.stdout.write(stdout.subarray(0, 1));
		child.stderr.write(stderr.subarray(0, 2));
		child.stdout.write(stdout.subarray(1));
		child.stderr.write(stderr.subarray(2));
		child.emit("close", 0);

		expect(await execution).toEqual({ stdout: "你好", stderr: "世界", code: 0, killed: false });
	});

	it("preserves a UTF-8 byte order mark", async () => {
		const child = mockChild();
		const execution = execCommand("utf8-test", [], process.cwd());
		const text = "\uFEFF你好";

		child.stdout.write(Buffer.from(text));
		child.emit("close", 0);

		expect((await execution).stdout).toBe(text);
	});

	it("flushes incomplete UTF-8 when output streams are destroyed on close", async () => {
		const child = mockChild();
		const execution = execCommand("utf8-test", [], process.cwd());
		const prefix = Buffer.from("你好").subarray(0, 1);

		child.stdout.write(prefix);
		child.stderr.write(prefix);
		child.emit("close", 0);

		expect(await execution).toEqual({ stdout: "�", stderr: "�", code: 0, killed: false });
	});

	it("flushes incomplete UTF-8 before reporting process errors", async () => {
		const child = mockChild();
		const execution = execCommand("utf8-test", [], process.cwd());
		const prefix = Buffer.from("你好").subarray(0, 1);

		child.stdout.write(prefix);
		child.stderr.write(prefix);
		child.emit("error", new Error("process error"));

		expect(await execution).toEqual({ stdout: "�", stderr: "�", code: 1, killed: false });
		child.stdout.destroy();
		child.stderr.destroy();
	});
});
