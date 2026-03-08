import { describe, expect, it, vi } from "vitest";
import { runSetupCommand } from "../src/cli/setup-command.js";

describe("setup command", () => {
	it("prints json status for installed python dependencies", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		process.exitCode = undefined;
		try {
			await runSetupCommand(["python", "--check", "--json"], {
				findExecutable(names) {
					if (names.includes("python3")) return "/usr/bin/python3";
					if (names.includes("uv")) return "/usr/bin/uv";
					if (names.includes("pip3")) return "/usr/bin/pip3";
					return undefined;
				},
				run(command, args) {
					if (command === "/usr/bin/python3" && args[0] === "-c") {
						return { status: 0, stdout: "", stderr: "" };
					}
					throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
				},
			});

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain('"available": true');
			expect(output).toContain('"/usr/bin/python3"');
			expect(process.exitCode).toBeUndefined();
		} finally {
			logSpy.mockRestore();
		}
	});

	it("installs missing python dependencies when not in check mode", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		process.exitCode = undefined;
		let installAttempts = 0;
		try {
			await runSetupCommand(["python"], {
				findExecutable(names) {
					if (names.includes("python3")) return "/usr/bin/python3";
					if (names.includes("uv")) return "/usr/bin/uv";
					if (names.includes("pip3")) return "/usr/bin/pip3";
					return undefined;
				},
				run(command, args) {
					if (command === "/usr/bin/python3" && args[0] === "-c") {
						if (installAttempts === 0) {
							const script = args[1] ?? "";
							if (script.includes('"kernel_gateway"')) {
								return { status: 1, stdout: "", stderr: "" };
							}
							if (script.includes('"ipykernel"')) {
								return { status: 0, stdout: "", stderr: "" };
							}
						}
						return { status: 0, stdout: "", stderr: "" };
					}
					if (command === "/usr/bin/uv" && args.slice(0, 3).join(" ") === "pip install --python") {
						installAttempts += 1;
						return { status: 0, stdout: "", stderr: "" };
					}
					throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
				},
			});

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("Installed missing Python dependencies");
			expect(installAttempts).toBe(1);
			expect(process.exitCode).toBeUndefined();
		} finally {
			logSpy.mockRestore();
		}
	});

	it("fails clearly on unsupported setup components", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		process.exitCode = undefined;
		try {
			await runSetupCommand(["stt"]);
			const output = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("Unknown setup component: stt");
			expect(process.exitCode).toBe(1);
		} finally {
			errorSpy.mockRestore();
		}
	});
});
