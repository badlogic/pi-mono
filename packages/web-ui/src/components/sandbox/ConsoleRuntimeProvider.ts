import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

/**
 * Console Runtime Provider
 *
 * REQUIRED provider that should always be included first.
 * Provides console capture, error handling, and execution lifecycle management.
 */
export class ConsoleRuntimeProvider implements SandboxRuntimeProvider {
	getData(): Record<string, any> {
		// No data needed
		return {};
	}

	getRuntime(): (sandboxId: string) => void {
		return (sandboxId: string) => {
			// Console capture
			const originalConsole = {
				log: console.log,
				error: console.error,
				warn: console.warn,
				info: console.info,
			};

			["log", "error", "warn", "info"].forEach((method) => {
				(console as any)[method] = (...args: any[]) => {
					const text = args
						.map((arg) => {
							try {
								return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
							} catch {
								return String(arg);
							}
						})
						.join(" ");

					window.parent.postMessage(
						{
							type: "console",
							sandboxId,
							method,
							text,
						},
						"*",
					);

					(originalConsole as any)[method].apply(console, args);
				};
			});

			// Track errors for HTML artifacts
			let lastError: { message: string; stack: string } | null = null;

			// Error handlers
			window.addEventListener("error", (e) => {
				const text =
					(e.error?.stack || e.message || String(e)) + " at line " + (e.lineno || "?") + ":" + (e.colno || "?");

				lastError = {
					message: e.error?.message || e.message || String(e),
					stack: e.error?.stack || text,
				};

				window.parent.postMessage(
					{
						type: "console",
						sandboxId,
						method: "error",
						text,
					},
					"*",
				);
			});

			window.addEventListener("unhandledrejection", (e) => {
				const text = "Unhandled promise rejection: " + (e.reason?.message || e.reason || "Unknown error");

				lastError = {
					message: e.reason?.message || String(e.reason) || "Unhandled promise rejection",
					stack: e.reason?.stack || text,
				};

				window.parent.postMessage(
					{
						type: "console",
						sandboxId,
						method: "error",
						text,
					},
					"*",
				);
			});

			// Expose complete() method for user code to call
			let completionSent = false;
			(window as any).complete = (error?: { message: string; stack: string }) => {
				if (completionSent) return;
				completionSent = true;

				const finalError = error || lastError;

				if (finalError) {
					window.parent.postMessage(
						{
							type: "execution-error",
							sandboxId,
							error: finalError,
						},
						"*",
					);
				} else {
					window.parent.postMessage(
						{
							type: "execution-complete",
							sandboxId,
						},
						"*",
					);
				}
			};

			// Fallback timeout for HTML artifacts that don't call complete()
			if (document.readyState === "complete" || document.readyState === "interactive") {
				setTimeout(() => (window as any).complete(), 2000);
			} else {
				window.addEventListener("load", () => {
					setTimeout(() => (window as any).complete(), 2000);
				});
			}
		};
	}
}
