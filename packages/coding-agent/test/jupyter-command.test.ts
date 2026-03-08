import { describe, expect, it, vi } from "vitest";
import { runJupyterCommand } from "../src/cli/jupyter-command.js";

describe("jupyter command", () => {
	it("prints json status when requested", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runJupyterCommand(["status", "--json"], {
				readStatus: () => ({
					active: true,
					pid: 4242,
					url: "http://127.0.0.1:8888",
					uptime: 90_000,
					pythonPath: "/usr/bin/python3",
					venvPath: "/tmp/pi-jupyter",
					statePath: "/tmp/pi-jupyter.json",
				}),
			});

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain('"active": true');
			expect(output).toContain('"pid": 4242');
		} finally {
			logSpy.mockRestore();
		}
	});

	it("shows a dim message when no gateway is running", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runJupyterCommand([], {
				readStatus: () => ({
					active: false,
					pid: null,
					url: null,
					uptime: null,
					pythonPath: null,
					venvPath: null,
					statePath: "/tmp/pi-jupyter.json",
				}),
			});

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("No Jupyter gateway is running");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("kills an active gateway", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const shutdown = vi.fn(async () => true);
		try {
			await runJupyterCommand(["kill"], {
				readStatus: () => ({
					active: true,
					pid: 31337,
					url: "http://127.0.0.1:8888",
					uptime: 5_000,
					pythonPath: null,
					venvPath: null,
					statePath: "/tmp/pi-jupyter.json",
				}),
				shutdown,
			});

			expect(shutdown).toHaveBeenCalled();
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("Killing Jupyter gateway (PID 31337)");
			expect(output).toContain("Jupyter gateway stopped");
		} finally {
			logSpy.mockRestore();
		}
	});
});
