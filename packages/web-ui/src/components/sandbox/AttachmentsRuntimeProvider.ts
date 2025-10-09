import { ATTACHMENTS_RUNTIME_DESCRIPTION } from "../../prompts/tool-prompts.js";
import type { Attachment } from "../../utils/attachment-utils.js";
import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

/**
 * Attachments Runtime Provider
 *
 * OPTIONAL provider that provides file access APIs to sandboxed code.
 * Only needed when attachments are present.
 */
export class AttachmentsRuntimeProvider implements SandboxRuntimeProvider {
	constructor(private attachments: Attachment[]) {}

	getData(): Record<string, any> {
		const attachmentsData = this.attachments.map((a) => ({
			id: a.id,
			fileName: a.fileName,
			mimeType: a.mimeType,
			size: a.size,
			content: a.content,
			extractedText: a.extractedText,
		}));

		return { attachments: attachmentsData };
	}

	getRuntime(): (sandboxId: string) => void {
		// This function will be stringified, so no external references!
		return (sandboxId: string) => {
			// Helper functions for attachments
			(window as any).listFiles = () =>
				((window as any).attachments || []).map((a: any) => ({
					id: a.id,
					fileName: a.fileName,
					mimeType: a.mimeType,
					size: a.size,
				}));

			(window as any).readTextFile = (attachmentId: string) => {
				const a = ((window as any).attachments || []).find((x: any) => x.id === attachmentId);
				if (!a) throw new Error("Attachment not found: " + attachmentId);
				if (a.extractedText) return a.extractedText;
				try {
					return atob(a.content);
				} catch {
					throw new Error("Failed to decode text content for: " + attachmentId);
				}
			};

			(window as any).readBinaryFile = (attachmentId: string) => {
				const a = ((window as any).attachments || []).find((x: any) => x.id === attachmentId);
				if (!a) throw new Error("Attachment not found: " + attachmentId);
				const bin = atob(a.content);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				return bytes;
			};

			(window as any).returnFile = async (fileName: string, content: any, mimeType?: string) => {
				let finalContent: any, finalMimeType: string;

				if (content instanceof Blob) {
					const arrayBuffer = await content.arrayBuffer();
					finalContent = new Uint8Array(arrayBuffer);
					finalMimeType = mimeType || content.type || "application/octet-stream";
					if (!mimeType && !content.type) {
						throw new Error(
							"returnFile: MIME type is required for Blob content. Please provide a mimeType parameter (e.g., 'image/png').",
						);
					}
				} else if (content instanceof Uint8Array) {
					finalContent = content;
					if (!mimeType) {
						throw new Error(
							"returnFile: MIME type is required for Uint8Array content. Please provide a mimeType parameter (e.g., 'image/png').",
						);
					}
					finalMimeType = mimeType;
				} else if (typeof content === "string") {
					finalContent = content;
					finalMimeType = mimeType || "text/plain";
				} else {
					finalContent = JSON.stringify(content, null, 2);
					finalMimeType = mimeType || "application/json";
				}

				window.parent.postMessage(
					{
						type: "file-returned",
						sandboxId,
						fileName,
						content: finalContent,
						mimeType: finalMimeType,
					},
					"*",
				);
			};
		};
	}

	getDescription(): string {
		return ATTACHMENTS_RUNTIME_DESCRIPTION;
	}
}
