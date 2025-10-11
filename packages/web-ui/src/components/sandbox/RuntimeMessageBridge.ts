/**
 * Generates sendRuntimeMessage() function for injection into execution contexts.
 * Provides unified messaging API that works in both sandbox iframe and user script contexts.
 */

export type MessageType = "request-response" | "fire-and-forget";

export interface RuntimeMessageBridgeOptions {
	context: "sandbox-iframe" | "user-script";
	sandboxId: string;
}

// biome-ignore lint/complexity/noStaticOnlyClass: fine
export class RuntimeMessageBridge {
	/**
	 * Generate sendRuntimeMessage() function as injectable string.
	 * Returns the function source code to be injected into target context.
	 */
	static generateBridgeCode(options: RuntimeMessageBridgeOptions): string {
		if (options.context === "sandbox-iframe") {
			return RuntimeMessageBridge.generateSandboxBridge(options.sandboxId);
		} else {
			return RuntimeMessageBridge.generateUserScriptBridge(options.sandboxId);
		}
	}

	private static generateSandboxBridge(sandboxId: string): string {
		// Returns stringified function that uses window.parent.postMessage
		return `
window.__completionCallbacks = [];
window.sendRuntimeMessage = async (message) => {
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    return new Promise((resolve, reject) => {
        const handler = (e) => {
            if (e.data.type === 'runtime-response' && e.data.messageId === messageId) {
                window.removeEventListener('message', handler);
                if (e.data.success) {
                    resolve(e.data);
                } else {
                    reject(new Error(e.data.error || 'Operation failed'));
                }
            }
        };

        window.addEventListener('message', handler);

        window.parent.postMessage({
            ...message,
            sandboxId: ${JSON.stringify(sandboxId)},
            messageId: messageId
        }, '*');

        // Timeout after 30s
        setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('Runtime message timeout'));
        }, 30000);
    });
};
window.onCompleted = (callback) => {
    window.__completionCallbacks.push(callback);
};
`.trim();
	}

	private static generateUserScriptBridge(sandboxId: string): string {
		// Returns stringified function that uses chrome.runtime.sendMessage
		return `
window.__completionCallbacks = [];
window.sendRuntimeMessage = async (message) => {
    return await chrome.runtime.sendMessage({
        ...message,
        sandboxId: ${JSON.stringify(sandboxId)}
    });
};
window.onCompleted = (callback) => {
    window.__completionCallbacks.push(callback);
};
`.trim();
	}
}
