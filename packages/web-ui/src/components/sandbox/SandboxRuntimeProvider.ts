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
	 * All providers receive all messages - decide internally what to handle.
	 *
	 * @param message - The message from the sandbox
	 * @param respond - Function to send a response back to the sandbox
	 */
	handleMessage?(message: any, respond: (response: any) => void): Promise<void>;

	/**
	 * Optional documentation describing what globals/functions this provider injects.
	 * This will be appended to tool descriptions dynamically so the LLM knows what's available.
	 */
	getDescription?(): string;
}
