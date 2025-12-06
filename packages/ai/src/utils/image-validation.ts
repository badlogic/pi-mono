import { imageSize } from "image-size";
import type { ImageContent, Message } from "../types.js";

interface ManyImageLimit {
	threshold: number;
	maxDimension: number;
}

export interface ImageValidationLimits {
	providerLabel: string;
	maxBytes?: number;
	maxDimension?: number;
	manyImageLimit?: ManyImageLimit;
	maxImages?: number;
}

interface SanitizeResult {
	messages: Message[];
	note?: string;
}

interface ImageEntry {
	msgIndex: number;
	blockIndex: number;
	sizeBytes: number;
	dims?: { width: number; height: number };
	removed?: "bytes" | "dimension" | "many" | "maxImages";
}

export function sanitizeImages(messages: Message[], limits: ImageValidationLimits): SanitizeResult {
	const cloned: Message[] = messages.map((m) => {
		if ((m.role === "user" || m.role === "toolResult") && Array.isArray(m.content)) {
			return { ...m, content: [...m.content] } as Message;
		}
		return m;
	});

	const entries: ImageEntry[] = [];

	for (let i = 0; i < cloned.length; i++) {
		const msg = cloned[i];
		if (!Array.isArray(msg.content)) continue;
		if (msg.role !== "user" && msg.role !== "toolResult") continue;

		for (let j = 0; j < msg.content.length; j++) {
			const block = msg.content[j];
			if (block.type !== "image") continue;
			const img = block as ImageContent;
			const sizeBytes = Buffer.byteLength(img.data, "base64");
			const dims = limits.maxDimension || limits.manyImageLimit ? safeImageSize(img) : undefined;
			entries.push({ msgIndex: i, blockIndex: j, sizeBytes, dims });
		}
	}

	for (const entry of entries) {
		if (limits.maxBytes !== undefined && entry.sizeBytes > limits.maxBytes) {
			entry.removed = "bytes";
			continue;
		}
		if (
			limits.maxDimension !== undefined &&
			entry.dims &&
			(entry.dims.width > limits.maxDimension || entry.dims.height > limits.maxDimension)
		) {
			entry.removed = "dimension";
		}
	}

	let kept = entries.filter((e) => !e.removed);

	if (limits.manyImageLimit && kept.length > limits.manyImageLimit.threshold) {
		for (const entry of kept) {
			if (
				entry.dims &&
				(entry.dims.width > limits.manyImageLimit.maxDimension ||
					entry.dims.height > limits.manyImageLimit.maxDimension)
			) {
				entry.removed = "many";
			}
		}
		kept = kept.filter((e) => !e.removed);
	}

	if (limits.maxImages !== undefined && kept.length > limits.maxImages) {
		const toRemove = kept.length - limits.maxImages;
		for (let k = 0; k < toRemove; k++) {
			kept[k].removed = "maxImages";
		}
	}

	const removalsByMsg = new Map<number, Set<number>>();
	for (const entry of entries) {
		if (!entry.removed) continue;
		if (!removalsByMsg.has(entry.msgIndex)) removalsByMsg.set(entry.msgIndex, new Set());
		removalsByMsg.get(entry.msgIndex)!.add(entry.blockIndex);
	}

	for (const [msgIndex, indexes] of removalsByMsg.entries()) {
		const msg = cloned[msgIndex];
		if (!Array.isArray(msg.content)) continue;
		msg.content = msg.content.filter((_, idx) => !indexes.has(idx)) as typeof msg.content;
	}

	const finalMessages = cloned
		.map((msg) => {
			if (!Array.isArray(msg.content)) return msg;
			if (msg.role !== "user" && msg.role !== "toolResult") return msg;
			return msg.content.length === 0 ? null : msg;
		})
		.filter(Boolean) as Message[];

	const removedBytes = entries.filter((e) => e.removed === "bytes").length;
	const removedDim = entries.filter((e) => e.removed === "dimension").length;
	const removedMany = entries.filter((e) => e.removed === "many").length;
	const removedMax = entries.filter((e) => e.removed === "maxImages").length;
	const notes: string[] = [];
	addNote(notes, removedBytes, `over size limit (${limitMb(limits.maxBytes)}MB)`);
	addNote(notes, removedDim, `over dimension limit (${limits.maxDimension}px)`);
	if (limits.manyImageLimit) {
		addNote(
			notes,
			removedMany,
			`over ${limits.manyImageLimit.maxDimension}px when >${limits.manyImageLimit.threshold} images`,
		);
	}
	if (limits.maxImages !== undefined) {
		addNote(notes, removedMax, `dropped to stay within ${limits.maxImages} images`);
	}

	const note = notes.length > 0 ? `${limits.providerLabel} note: removed ${notes.join(", ")}.` : undefined;

	return { messages: finalMessages, note };
}

function safeImageSize(img: ImageContent): { width: number; height: number } | undefined {
	try {
		const buffer = Buffer.from(img.data, "base64");
		const { width = 0, height = 0 } = imageSize(buffer);
		return { width, height };
	} catch {
		return undefined;
	}
}

function addNote(notes: string[], count: number, reason: string): void {
	if (count > 0) notes.push(`${count} image${count > 1 ? "s" : ""} ${reason}`);
}

function limitMb(bytes?: number): string {
	return bytes !== undefined ? (bytes / (1024 * 1024)).toFixed(0) : "";
}
