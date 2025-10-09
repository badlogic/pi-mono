import { ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION } from "../../prompts/tool-prompts.js";
import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

/**
 * Artifacts Runtime Provider
 *
 * Provides programmatic access to session artifacts from sandboxed code.
 * Allows code to create, read, update, and delete artifacts dynamically.
 */
export class ArtifactsRuntimeProvider implements SandboxRuntimeProvider {
	constructor(
		private getArtifactsFn: () => Map<string, { content: string }>,
		private createArtifactFn: (filename: string, content: string, title?: string) => Promise<void>,
		private updateArtifactFn: (filename: string, content: string, title?: string) => Promise<void>,
		private deleteArtifactFn: (filename: string) => Promise<void>,
		private appendMessageFn?: (message: any) => void,
	) {}

	getData(): Record<string, any> {
		// No initial data injection needed - artifacts are accessed via async functions
		return {};
	}

	getRuntime(): (sandboxId: string) => void {
		// This function will be stringified, so no external references!
		return (sandboxId: string) => {
			// Helper to send message and wait for response
			const sendArtifactMessage = (action: string, data: any): Promise<any> => {
				console.log("Sending artifact message:", action, data);
				return new Promise((resolve, reject) => {
					const messageId = `artifact_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

					const handler = (event: MessageEvent) => {
						if (event.data.type === "artifact-response" && event.data.messageId === messageId) {
							window.removeEventListener("message", handler);
							if (event.data.success) {
								resolve(event.data.result);
							} else {
								reject(new Error(event.data.error || "Artifact operation failed"));
							}
						}
					};

					window.addEventListener("message", handler);

					window.parent.postMessage(
						{
							type: "artifact-operation",
							sandboxId,
							messageId,
							action,
							data,
						},
						"*",
					);
				});
			};

			// Auto-parse/stringify for .json files
			const isJsonFile = (filename: string) => filename.endsWith(".json");

			(window as any).hasArtifact = async (filename: string): Promise<boolean> => {
				return await sendArtifactMessage("has", { filename });
			};

			(window as any).getArtifact = async (filename: string): Promise<any> => {
				const content = await sendArtifactMessage("get", { filename });
				// Auto-parse .json files
				if (isJsonFile(filename)) {
					try {
						return JSON.parse(content);
					} catch (e) {
						throw new Error(`Failed to parse JSON from ${filename}: ${e}`);
					}
				}
				return content;
			};

			(window as any).createArtifact = async (filename: string, content: any, mimeType?: string): Promise<void> => {
				let finalContent = content;
				let finalMimeType = mimeType;

				// Auto-stringify .json files
				if (isJsonFile(filename) && typeof content !== "string") {
					finalContent = JSON.stringify(content, null, 2);
					finalMimeType = mimeType || "application/json";
				} else if (typeof content === "string") {
					finalContent = content;
					finalMimeType = mimeType || "text/plain";
				} else {
					finalContent = JSON.stringify(content, null, 2);
					finalMimeType = mimeType || "application/json";
				}

				await sendArtifactMessage("create", { filename, content: finalContent, mimeType: finalMimeType });
			};

			(window as any).updateArtifact = async (filename: string, content: any, mimeType?: string): Promise<void> => {
				let finalContent = content;
				let finalMimeType = mimeType;

				// Auto-stringify .json files
				if (isJsonFile(filename) && typeof content !== "string") {
					finalContent = JSON.stringify(content, null, 2);
					finalMimeType = mimeType || "application/json";
				} else if (typeof content === "string") {
					finalContent = content;
					finalMimeType = mimeType || "text/plain";
				} else {
					finalContent = JSON.stringify(content, null, 2);
					finalMimeType = mimeType || "application/json";
				}

				await sendArtifactMessage("update", { filename, content: finalContent, mimeType: finalMimeType });
			};

			(window as any).deleteArtifact = async (filename: string): Promise<void> => {
				await sendArtifactMessage("delete", { filename });
			};
		};
	}

	async handleMessage(message: any, respond: (response: any) => void): Promise<boolean> {
		if (message.type !== "artifact-operation") {
			return false;
		}

		const { action, data, messageId } = message;

		const sendResponse = (success: boolean, result?: any, error?: string) => {
			respond({
				type: "artifact-response",
				messageId,
				success,
				result,
				error,
			});
		};

		try {
			switch (action) {
				case "has": {
					const artifacts = this.getArtifactsFn();
					const exists = artifacts.has(data.filename);
					sendResponse(true, exists);
					break;
				}

				case "get": {
					const artifacts = this.getArtifactsFn();
					const artifact = artifacts.get(data.filename);
					if (!artifact) {
						sendResponse(false, undefined, `Artifact not found: ${data.filename}`);
					} else {
						sendResponse(true, artifact.content);
					}
					break;
				}

				case "create": {
					try {
						// Note: mimeType parameter is ignored - artifact type is inferred from filename extension
						// Third parameter is title, defaults to filename
						await this.createArtifactFn(data.filename, data.content, data.filename);
						// Append artifact message for session persistence
						this.appendMessageFn?.({
							role: "artifact",
							action: "create",
							filename: data.filename,
							content: data.content,
							title: data.filename,
							timestamp: new Date().toISOString(),
						});
						sendResponse(true);
					} catch (err: any) {
						sendResponse(false, undefined, err.message);
					}
					break;
				}

				case "update": {
					try {
						// Note: mimeType parameter is ignored - artifact type is inferred from filename extension
						// Third parameter is title, defaults to filename
						await this.updateArtifactFn(data.filename, data.content, data.filename);
						// Append artifact message for session persistence
						this.appendMessageFn?.({
							role: "artifact",
							action: "update",
							filename: data.filename,
							content: data.content,
							timestamp: new Date().toISOString(),
						});
						sendResponse(true);
					} catch (err: any) {
						sendResponse(false, undefined, err.message);
					}
					break;
				}

				case "delete": {
					try {
						await this.deleteArtifactFn(data.filename);
						// Append artifact message for session persistence
						this.appendMessageFn?.({
							role: "artifact",
							action: "delete",
							filename: data.filename,
							timestamp: new Date().toISOString(),
						});
						sendResponse(true);
					} catch (err: any) {
						sendResponse(false, undefined, err.message);
					}
					break;
				}

				default:
					sendResponse(false, undefined, `Unknown artifact action: ${action}`);
			}

			return true;
		} catch (error: any) {
			sendResponse(false, undefined, error.message);
			return true;
		}
	}

	getDescription(): string {
		return ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION;
	}
}
