/**
 * Interface for providing runtime capabilities to sandboxed iframes.
 * Each provider injects data and runtime functions into the sandbox context.
 */
export interface SandboxRuntimeProvider {
	/**
	 * Returns data to inject into window scope.
	 * Keys become window properties (e.g., { attachments: [...] } -> window.attachments)
	 */
	getData(): Record<string, any>;

	/**
	 * Returns a runtime function that will be stringified and executed in the sandbox.
	 * The function receives sandboxId and has access to data from getData() via window.
	 *
	 * IMPORTANT: This function will be converted to string via .toString() and injected
	 * into the sandbox, so it cannot reference external variables or imports.
	 */
	getRuntime(): (sandboxId: string) => void;

	/**
	 * Optional message handler for bidirectional communication.
	 * Return true if the message was handled, false to let other handlers try.
	 *
	 * @param message - The message from the sandbox
	 * @param respond - Function to send a response back to the sandbox
	 * @returns true if message was handled, false otherwise
	 */
	handleMessage?(message: any, respond: (response: any) => void): boolean;
}
