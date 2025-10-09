import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

export interface ConsoleLog {
	type: "log" | "warn" | "error" | "info";
	text: string;
	args?: unknown[];
}

/**
 * Console Runtime Provider
 *
 * REQUIRED provider that should always be included first.
 * Provides console capture, error handling, and execution lifecycle management.
 * Collects console output for retrieval by caller.
 */
export class ConsoleRuntimeProvider implements SandboxRuntimeProvider {
	private logs: ConsoleLog[] = [];
	private completionError: { message: string; stack: string } | null = null;
	private completed = false;

	getData(): Record<string, any> {
		// No data needed
		return {};
	}

	getRuntime(): (sandboxId: string) => void {
		return (_sandboxId: string) => {
			// Console capture with immediate send + completion batch pattern
			const originalConsole = {
				log: console.log,
				error: console.error,
				warn: console.warn,
				info: console.info,
			};

			// Track pending logs (not yet confirmed sent)
			const pendingLogs: Array<{ method: string; text: string; args: any[] }> = [];

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

					const logEntry = { method, text, args };

					// Add to pending logs
					pendingLogs.push(logEntry);

					// Try to send immediately (fire-and-forget)
					if ((window as any).sendRuntimeMessage) {
						(window as any)
							.sendRuntimeMessage({
								type: "console",
								method,
								text,
								args, // Send raw args for provider collection
							})
							.then(() => {
								// Remove from pending on successful send
								const index = pendingLogs.indexOf(logEntry);
								if (index !== -1) {
									pendingLogs.splice(index, 1);
								}
							})
							.catch(() => {
								// Keep in pending array if send fails
							});
					}

					// Always log locally too
					(originalConsole as any)[method].apply(console, args);
				};
			});

			// Register completion callback to send any remaining logs
			if ((window as any).onCompleted) {
				(window as any).onCompleted(async (_success: boolean) => {
					// Send any logs that haven't been sent yet
					if (pendingLogs.length > 0 && (window as any).sendRuntimeMessage) {
						await Promise.all(
							pendingLogs.map((logEntry) =>
								(window as any).sendRuntimeMessage({
									type: "console",
									method: logEntry.method,
									text: logEntry.text,
									args: logEntry.args,
								}),
							),
						);
					}
				});
			}

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

				if ((window as any).sendRuntimeMessage) {
					(window as any)
						.sendRuntimeMessage({
							type: "console",
							method: "error",
							text,
						})
						.catch(() => {});
				}
			});

			window.addEventListener("unhandledrejection", (e) => {
				const text = "Unhandled promise rejection: " + (e.reason?.message || e.reason || "Unknown error");

				lastError = {
					message: e.reason?.message || String(e.reason) || "Unhandled promise rejection",
					stack: e.reason?.stack || text,
				};

				if ((window as any).sendRuntimeMessage) {
					(window as any)
						.sendRuntimeMessage({
							type: "console",
							method: "error",
							text,
						})
						.catch(() => {});
				}
			});

			// Expose complete() method for user code to call
			let completionSent = false;
			(window as any).complete = (error?: { message: string; stack: string }) => {
				if (completionSent) return;
				completionSent = true;

				const finalError = error || lastError;

				if ((window as any).sendRuntimeMessage) {
					if (finalError) {
						(window as any)
							.sendRuntimeMessage({
								type: "execution-error",
								error: finalError,
							})
							.catch(() => {});
					} else {
						(window as any)
							.sendRuntimeMessage({
								type: "execution-complete",
							})
							.catch(() => {});
					}
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

	async handleMessage(message: any, _respond: (response: any) => void): Promise<boolean> {
		if (message.type === "console") {
			// Collect console output
			this.logs.push({
				type:
					message.method === "error"
						? "error"
						: message.method === "warn"
							? "warn"
							: message.method === "info"
								? "info"
								: "log",
				text: message.text,
				args: message.args,
			});
			return true;
		}

		if (message.type === "execution-complete") {
			this.completed = true;
			return true;
		}

		if (message.type === "execution-error") {
			this.completed = true;
			this.completionError = message.error;
			return true;
		}

		return false;
	}

	/**
	 * Get collected console logs
	 */
	getLogs(): ConsoleLog[] {
		return this.logs;
	}

	/**
	 * Get completion status
	 */
	isCompleted(): boolean {
		return this.completed;
	}

	/**
	 * Get completion error if any
	 */
	getCompletionError(): { message: string; stack: string } | null {
		return this.completionError;
	}

	/**
	 * Reset state for reuse
	 */
	reset(): void {
		this.logs = [];
		this.completionError = null;
		this.completed = false;
	}
}
