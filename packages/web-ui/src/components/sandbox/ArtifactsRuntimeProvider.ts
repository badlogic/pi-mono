import { ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION } from "../../prompts/tool-prompts.js";
import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

/**
 * Artifacts Runtime Provider
 *
 * Provides programmatic access to session artifacts from sandboxed code.
 * Allows code to create, read, update, and delete artifacts dynamically.
 * Supports both online (extension) and offline (downloaded HTML) modes.
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
		// Inject artifact snapshot for offline mode
		const snapshot: Record<string, string> = {};
		const artifacts = this.getArtifactsFn();
		artifacts.forEach((artifact, filename) => {
			snapshot[filename] = artifact.content;
		});
		return { artifacts: snapshot };
	}

	getRuntime(): (sandboxId: string) => void {
		// This function will be stringified, so no external references!
		return (_sandboxId: string) => {
			// Auto-parse/stringify for .json files
			const isJsonFile = (filename: string) => filename.endsWith(".json");

			(window as any).hasArtifact = async (filename: string): Promise<boolean> => {
				// Online: ask extension
				if ((window as any).sendRuntimeMessage) {
					const response = await (window as any).sendRuntimeMessage({
						type: "artifact-operation",
						action: "has",
						filename,
					});
					if (!response.success) throw new Error(response.error);
					return response.result;
				}
				// Offline: check snapshot
				else {
					return !!(window as any).artifacts?.[filename];
				}
			};

			(window as any).getArtifact = async (filename: string): Promise<any> => {
				let content: string;

				// Online: ask extension
				if ((window as any).sendRuntimeMessage) {
					const response = await (window as any).sendRuntimeMessage({
						type: "artifact-operation",
						action: "get",
						filename,
					});
					if (!response.success) throw new Error(response.error);
					content = response.result;
				}
				// Offline: read snapshot
				else {
					if (!(window as any).artifacts?.[filename]) {
						throw new Error(`Artifact not found (offline mode): ${filename}`);
					}
					content = (window as any).artifacts[filename];
				}

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
				if (!(window as any).sendRuntimeMessage) {
					throw new Error("Cannot create artifacts in offline mode (read-only)");
				}

				let finalContent = content;
				// Auto-stringify .json files
				if (isJsonFile(filename) && typeof content !== "string") {
					finalContent = JSON.stringify(content, null, 2);
				} else if (typeof content !== "string") {
					finalContent = JSON.stringify(content, null, 2);
				}

				const response = await (window as any).sendRuntimeMessage({
					type: "artifact-operation",
					action: "create",
					filename,
					content: finalContent,
					mimeType,
				});
				if (!response.success) throw new Error(response.error);
			};

			(window as any).updateArtifact = async (filename: string, content: any, mimeType?: string): Promise<void> => {
				if (!(window as any).sendRuntimeMessage) {
					throw new Error("Cannot update artifacts in offline mode (read-only)");
				}

				let finalContent = content;
				// Auto-stringify .json files
				if (isJsonFile(filename) && typeof content !== "string") {
					finalContent = JSON.stringify(content, null, 2);
				} else if (typeof content !== "string") {
					finalContent = JSON.stringify(content, null, 2);
				}

				const response = await (window as any).sendRuntimeMessage({
					type: "artifact-operation",
					action: "update",
					filename,
					content: finalContent,
					mimeType,
				});
				if (!response.success) throw new Error(response.error);
			};

			(window as any).deleteArtifact = async (filename: string): Promise<void> => {
				if (!(window as any).sendRuntimeMessage) {
					throw new Error("Cannot delete artifacts in offline mode (read-only)");
				}

				const response = await (window as any).sendRuntimeMessage({
					type: "artifact-operation",
					action: "delete",
					filename,
				});
				if (!response.success) throw new Error(response.error);
			};
		};
	}

	async handleMessage(message: any, respond: (response: any) => void): Promise<boolean> {
		if (message.type !== "artifact-operation") {
			return false;
		}

		const { action, filename, content, mimeType } = message;

		try {
			switch (action) {
				case "has": {
					const artifacts = this.getArtifactsFn();
					const exists = artifacts.has(filename);
					respond({ success: true, result: exists });
					break;
				}

				case "get": {
					const artifacts = this.getArtifactsFn();
					const artifact = artifacts.get(filename);
					if (!artifact) {
						respond({ success: false, error: `Artifact not found: ${filename}` });
					} else {
						respond({ success: true, result: artifact.content });
					}
					break;
				}

				case "create": {
					try {
						await this.createArtifactFn(filename, content, filename);
						this.appendMessageFn?.({
							role: "artifact",
							action: "create",
							filename,
							content,
							title: filename,
							timestamp: new Date().toISOString(),
						});
						respond({ success: true });
					} catch (err: any) {
						respond({ success: false, error: err.message });
					}
					break;
				}

				case "update": {
					try {
						await this.updateArtifactFn(filename, content, filename);
						this.appendMessageFn?.({
							role: "artifact",
							action: "update",
							filename,
							content,
							timestamp: new Date().toISOString(),
						});
						respond({ success: true });
					} catch (err: any) {
						respond({ success: false, error: err.message });
					}
					break;
				}

				case "delete": {
					try {
						await this.deleteArtifactFn(filename);
						this.appendMessageFn?.({
							role: "artifact",
							action: "delete",
							filename,
							timestamp: new Date().toISOString(),
						});
						respond({ success: true });
					} catch (err: any) {
						respond({ success: false, error: err.message });
					}
					break;
				}

				default:
					respond({ success: false, error: `Unknown artifact action: ${action}` });
			}

			return true;
		} catch (error: any) {
			respond({ success: false, error: error.message });
			return true;
		}
	}

	getDescription(): string {
		return ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION;
	}
}
