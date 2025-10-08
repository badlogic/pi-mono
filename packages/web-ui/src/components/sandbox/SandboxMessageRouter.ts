import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

/**
 * Message consumer interface - components that want to receive messages from sandboxes
 */
export interface MessageConsumer {
	/**
	 * Handle a message from a sandbox.
	 * @returns true if message was consumed (stops propagation), false otherwise
	 */
	handleMessage(message: any): boolean;
}

/**
 * Sandbox context - tracks active sandboxes and their consumers
 */
interface SandboxContext {
	sandboxId: string;
	iframe: HTMLIFrameElement | null; // null until setSandboxIframe()
	providers: SandboxRuntimeProvider[];
	consumers: Set<MessageConsumer>;
}

/**
 * Centralized message router for all sandbox communication.
 *
 * This singleton replaces all individual window.addEventListener("message") calls
 * with a single global listener that routes messages to the appropriate handlers.
 *
 * Benefits:
 * - Single global listener instead of multiple independent listeners
 * - Automatic cleanup when sandboxes are destroyed
 * - Support for bidirectional communication (providers) and broadcasting (consumers)
 * - Clear lifecycle management
 */
export class SandboxMessageRouter {
	private sandboxes = new Map<string, SandboxContext>();
	private messageListener: ((e: MessageEvent) => void) | null = null;

	/**
	 * Register a new sandbox with its runtime providers.
	 * Call this BEFORE creating the iframe.
	 */
	registerSandbox(sandboxId: string, providers: SandboxRuntimeProvider[], consumers: MessageConsumer[]): void {
		this.sandboxes.set(sandboxId, {
			sandboxId,
			iframe: null, // Will be set via setSandboxIframe()
			providers,
			consumers: new Set(consumers),
		});

		// Setup global listener if not already done
		this.setupListener();
		console.log("Registered sandbox:", sandboxId);
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

		// If no more sandboxes, remove global listener
		if (this.sandboxes.size === 0 && this.messageListener) {
			window.removeEventListener("message", this.messageListener);
			this.messageListener = null;
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
	 * Setup the global message listener (called automatically)
	 */
	private setupListener(): void {
		if (this.messageListener) return;

		this.messageListener = (e: MessageEvent) => {
			const { sandboxId } = e.data;
			if (!sandboxId) return;

			console.log("Router received message for sandbox:", sandboxId, e.data);

			const context = this.sandboxes.get(sandboxId);
			if (!context) return;

			// Create respond() function for bidirectional communication
			const respond = (response: any) => {
				if (!response.sandboxId) response.sandboxId = sandboxId;
				context.iframe?.contentWindow?.postMessage(response, "*");
			};

			// 1. Try provider handlers first (for bidirectional comm like memory)
			for (const provider of context.providers) {
				if (provider.handleMessage) {
					const handled = provider.handleMessage(e.data, respond);
					if (handled) return; // Stop if handled
				}
			}

			// 2. Broadcast to consumers (for one-way messages like console)
			for (const consumer of context.consumers) {
				const consumed = consumer.handleMessage(e.data);
				if (consumed) break; // Stop if consumed
			}
		};

		window.addEventListener("message", this.messageListener);
	}
}

/**
 * Global singleton instance.
 * Import this from wherever you need to interact with the message router.
 */
export const SANDBOX_MESSAGE_ROUTER = new SandboxMessageRouter();
