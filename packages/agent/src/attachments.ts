import type { DocumentContent, ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { Attachment } from "./types.js";

export type AttachmentContentBlock = TextContent | ImageContent | DocumentContent;

export function attachmentsToContentBlocks(attachments: Attachment[]): AttachmentContentBlock[] {
	const blocks: AttachmentContentBlock[] = [];

	for (const attachment of attachments) {
		if (attachment.type === "image") {
			blocks.push({
				type: "image",
				data: attachment.content,
				mimeType: attachment.mimeType,
			});
			continue;
		}

		if (attachment.type === "document") {
			if (attachment.extractedText) {
				blocks.push({
					type: "text",
					text: `\n\n[Document: ${attachment.fileName}]\n${attachment.extractedText}`,
					isDocument: true,
				});
			} else {
				blocks.push({
					type: "document",
					data: attachment.content,
					mimeType: attachment.mimeType,
					fileName: attachment.fileName,
				});
			}
		}
	}

	return blocks;
}
