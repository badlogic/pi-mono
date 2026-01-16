import { ATTACHMENTS_RUNTIME_DESCRIPTION } from "../../prompts/prompts.js";
import type { Attachment } from "../../utils/attachment-utils.js";
import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

/**
 * Attachments Runtime Provider
 *
 * OPTIONAL provider that provides file access APIs to sandboxed code.
 * Only needed when attachments are present.
 * Attachments are read-only snapshot data - no messaging needed.
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
		// These functions read directly from window.attachments
		// Works both online AND offline (no messaging needed!)
		return (_sandboxId: string) => {
			(window as any).listAttachments = () =>
				((window as any).attachments || []).map((a: any) => ({
					id: a.id,
					fileName: a.fileName,
					mimeType: a.mimeType,
					size: a.size,
				}));

			(window as any).readTextAttachment = (attachmentId: string) => {
				const a = ((window as any).attachments || []).find((x: any) => x.id === attachmentId);
				if (!a) throw new Error(`Attachment not found: ${attachmentId}`);
				if (a.extractedText) return a.extractedText;
				try {
					return atob(a.content);
				} catch {
					throw new Error(`Failed to decode text content for: ${attachmentId}`);
				}
			};

			(window as any).readBinaryAttachment = (attachmentId: string) => {
				const a = ((window as any).attachments || []).find((x: any) => x.id === attachmentId);
				if (!a) throw new Error(`Attachment not found: ${attachmentId}`);
				const bin = atob(a.content);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				return bytes;
			};
		};
	}

	getDescription(): string {
		return ATTACHMENTS_RUNTIME_DESCRIPTION;
	}
}
