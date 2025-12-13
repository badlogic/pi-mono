/**
 * Utility for generating consistent placeholder text when binary attachments
 * (images, documents) are present but no text content exists.
 */

export interface AttachmentPlaceholderOptions {
	hasImages: boolean;
	hasDocuments: boolean;
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
	const { hasImages, hasDocuments, supportsNativeDocuments } = options;

	if (!hasImages && !hasDocuments) {
		return "";
	}

	if (supportsNativeDocuments) {
		// Anthropic, Google - documents are passed natively
		if (hasDocuments && !hasImages) {
			return "(see attached document)";
		}
		if (hasImages && !hasDocuments) {
			return "(see attached image)";
		}
		return "(see attached files)";
	}

	// OpenAI and other providers - documents are not supported natively
	if (hasImages && !hasDocuments) {
		return "(see attached image)";
	}
	if (hasDocuments && !hasImages) {
		return "(document attachment omitted: provider does not support native documents)";
	}
	// Both images and documents
	return "(see attached image; document attachment omitted)";
}
