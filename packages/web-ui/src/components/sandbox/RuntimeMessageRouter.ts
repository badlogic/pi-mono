import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

// Type declaration for chrome extension API (when available)
declare const chrome: any;

/**
 * Message consumer interface - components that want to receive messages from sandboxes
 */
export interface MessageConsumer {
	/**
	 * Handle a message from a sandbox.
	 * All consumers receive all messages - decide internally what to handle.
	 */
	handleMessage(message: any): Promise<void>;
}

/**
 * Sandbox context - tracks active sandboxes and their consumers
 */
interface SandboxContext {
	sandboxId: string;
	iframe: HTMLIFrameElement | null; // null until setSandboxIframe() or null for user scripts
	providers: SandboxRuntimeProvider[];
	consumers: Set<MessageConsumer>;
}

/**
 * Centralized message router for all runtime communication.
 *
 * This singleton replaces all individual window.addEventListener("message") calls
 * with a single global listener that routes messages to the appropriate handlers.
 * Also handles user script messages from chrome.runtime.onUserScriptMessage.
 *
 * Benefits:
 * - Single global listener instead of multiple independent listeners
 * - Automatic cleanup when sandboxes are destroyed
 * - Support for bidirectional communication (providers) and broadcasting (consumers)
 * - Works with both sandbox iframes and user scripts
 * - Clear lifecycle management
 */
export class RuntimeMessageRouter {
	private sandboxes = new Map<string, SandboxContext>();
	private messageListener: ((e: MessageEvent) => void) | null = null;
	private userScriptMessageListener:
		| ((message: any, sender: any, sendResponse: (response: any) => void) => boolean)
		| null = null;

	/**
	 * Register a new sandbox with its runtime providers.
	 * Call this BEFORE creating the iframe (for sandbox contexts) or executing user script.
	 */
	registerSandbox(sandboxId: string, providers: SandboxRuntimeProvider[], consumers: MessageConsumer[]): void {
		this.sandboxes.set(sandboxId, {
			sandboxId,
			iframe: null, // Will be set via setSandboxIframe() for sandbox contexts
			providers,
			consumers: new Set(consumers),
		});

		// Setup global listener if not already done
		this.setupListener();
		console.log(`Registered sandbox: ${sandboxId}, providers: ${providers.length}, consumers: ${consumers.length}`);
	}

	/**
	 * Update the iframe reference for a sandbox.
	 * Call this AFTER creating the iframe.
	 * This is needed so providers can send responses back to the sandbox.
	 */
	setSandboxIframe(sandboxId: string, iframe: HTMLIFrameElement): void {
		const context = this.sandboxes.get(sandboxId);
		if (context) {
			context.iframe = iframe;
		}
		console.log("Set iframe for sandbox:", sandboxId);
	}

	/**
	 * Unregister a sandbox and remove all its consumers.
	 * Call this when the sandbox is destroyed.
	 */
	unregisterSandbox(sandboxId: string): void {
		this.sandboxes.delete(sandboxId);

		// If no more sandboxes, remove global listeners
		if (this.sandboxes.size === 0) {
			// Remove iframe listener
			if (this.messageListener) {
				window.removeEventListener("message", this.messageListener);
				this.messageListener = null;
			}

			// Remove user script listener
			if (this.userScriptMessageListener && typeof chrome !== "undefined" && chrome.runtime?.onUserScriptMessage) {
				chrome.runtime.onUserScriptMessage.removeListener(this.userScriptMessageListener);
				this.userScriptMessageListener = null;
			}
		}
		console.log("Unregistered sandbox:", sandboxId);
	}

	/**
	 * Add a message consumer for a sandbox.
	 * Consumers receive broadcast messages (console, execution-complete, etc.)
	 */
	addConsumer(sandboxId: string, consumer: MessageConsumer): void {
		const context = this.sandboxes.get(sandboxId);
		if (context) {
			context.consumers.add(consumer);
		}
		console.log("Added consumer for sandbox:", sandboxId);
	}

	/**
	 * Remove a message consumer from a sandbox.
	 */
	removeConsumer(sandboxId: string, consumer: MessageConsumer): void {
		const context = this.sandboxes.get(sandboxId);
		if (context) {
			context.consumers.delete(consumer);
		}
		console.log("Removed consumer for sandbox:", sandboxId);
	}

	/**
	 * Setup the global message listeners (called automatically)
	 */
	private setupListener(): void {
		// Setup sandbox iframe listener
		if (!this.messageListener) {
			this.messageListener = async (e: MessageEvent) => {
				const { sandboxId, messageId } = e.data;
				if (!sandboxId) return;

				console.log(
					"[ROUTER] Received message for sandbox:",
					sandboxId,
					"type:",
					e.data.type,
					"full message:",
					e.data,
				);

				const context = this.sandboxes.get(sandboxId);
				if (!context) {
					console.log("[ROUTER] No context found for sandbox:", sandboxId);
					return;
				}

				// Create respond() function for bidirectional communication
				const respond = (response: any) => {
					context.iframe?.contentWindow?.postMessage(
						{
							type: "runtime-response",
							messageId,
							sandboxId,
							...response,
						},
						"*",
					);
				};

				// 1. Try provider handlers first (for bidirectional comm)
				console.log("[ROUTER] Broadcasting to", context.providers.length, "providers");
				for (const provider of context.providers) {
					if (provider.handleMessage) {
						console.log("[ROUTER] Calling provider.handleMessage for", provider.constructor.name);
						await provider.handleMessage(e.data, respond);
						// Don't stop - let consumers also handle the message
					}
				}

				// 2. Broadcast to consumers (one-way messages or lifecycle events)
				console.log("[ROUTER] Broadcasting to", context.consumers.size, "consumers");
				for (const consumer of context.consumers) {
					console.log("[ROUTER] Calling consumer.handleMessage");
					await consumer.handleMessage(e.data);
					// Don't stop - let all consumers see the message
				}
			};

			window.addEventListener("message", this.messageListener);
		}

		// Setup user script message listener
		if (!this.userScriptMessageListener) {
			// Guard: check if we're in extension context
			if (typeof chrome === "undefined" || !chrome.runtime?.onUserScriptMessage) {
				console.log("[RuntimeMessageRouter] User script API not available (not in extension context)");
				return;
			}

			this.userScriptMessageListener = (message: any, _sender: any, sendResponse: (response: any) => void) => {
				const { sandboxId } = message;
				if (!sandboxId) return false;

				const context = this.sandboxes.get(sandboxId);
				if (!context) return false;

				console.log("Router received user script message for sandbox:", sandboxId, message);

				const respond = (response: any) => {
					sendResponse({
						...response,
						sandboxId,
					});
				};

				// Route to providers (async)
				(async () => {
					// 1. Try provider handlers first (for bidirectional comm)
					for (const provider of context.providers) {
						if (provider.handleMessage) {
							await provider.handleMessage(message, respond);
							// Don't stop - let consumers also handle the message
						}
					}

					// 2. Broadcast to consumers (one-way messages or lifecycle events)
					for (const consumer of context.consumers) {
						await consumer.handleMessage(message);
						// Don't stop - let all consumers see the message
					}
				})();

				return true; // Indicates async response
			};

			chrome.runtime.onUserScriptMessage.addListener(this.userScriptMessageListener);
			console.log("[RuntimeMessageRouter] Registered chrome.runtime.onUserScriptMessage listener");
		}
	}
}

/**
 * Global singleton instance.
 * Import this from wherever you need to interact with the message router.
 */
export const RUNTIME_MESSAGE_ROUTER = new RuntimeMessageRouter();
