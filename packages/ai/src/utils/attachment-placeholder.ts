/**
 * Utility for generating consistent placeholder text when binary attachments
 * (images, documents) are present but no text content exists.
 */

export interface AttachmentPlaceholderOptions {
	hasImages: boolean;
	hasDocuments: boolean;
	/** Whether the provider/model supports native image handling */
	supportsImages?: boolean;
	/** Whether the provider supports native document handling (e.g., Anthropic, Google) */
	supportsNativeDocuments: boolean;
}

/**
 * Generate a placeholder string for tool results or messages that contain
 * only binary content (images/documents) without text.
 *
 * Providers that support native documents get a simple placeholder.
 * Providers that don't support documents get an explicit "omitted" message.
 */
export function getAttachmentPlaceholder(options: AttachmentPlaceholderOptions): string {
	const { hasImages, hasDocuments, supportsImages = true, supportsNativeDocuments } = options;

	// Determine what will actually be sent vs omitted
	const willSendImages = hasImages && supportsImages;
	const willSendDocuments = hasDocuments && supportsNativeDocuments;
	const imagesOmitted = hasImages && !supportsImages;
	const documentsOmitted = hasDocuments && !supportsNativeDocuments;

	// Nothing to report
	if (!willSendImages && !willSendDocuments && !imagesOmitted && !documentsOmitted) {
		return "";
	}

	// Build placeholder based on what's sent and what's omitted
	const parts: string[] = [];

	// What will be sent
	if (willSendImages && willSendDocuments) {
		parts.push("(see attached files)");
	} else if (willSendImages) {
		parts.push("(see attached image)");
	} else if (willSendDocuments) {
		parts.push("(see attached document)");
	}

	// What was omitted
	if (imagesOmitted && documentsOmitted) {
		parts.push("(image and document attachments omitted: not supported by model)");
	} else if (imagesOmitted) {
		parts.push("(image attachment omitted: not supported by model)");
	} else if (documentsOmitted) {
		parts.push("(document attachment omitted: not supported by model)");
	}

	return parts.join(" ");
}

/**
 * Generate a placeholder for an individual document that cannot be sent natively.
 * Used when iterating over content blocks to replace unsupported documents.
 */
export function getDocumentOmittedPlaceholder(fileName?: string, mimeType?: string): string {
	if (fileName && mimeType) {
		return `[Document attachment omitted: ${fileName} (${mimeType})]`;
	}
	if (fileName) {
		return `[Document attachment omitted: ${fileName}]`;
	}
	if (mimeType) {
		return `[Document attachment omitted: ${mimeType}]`;
	}
	return "[Document attachment omitted]";
}
