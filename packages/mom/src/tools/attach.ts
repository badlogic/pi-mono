import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { basename, resolve as resolvePath } from "path";

// Per-channel upload functions to avoid race conditions when multiple channels are active
const uploadFns = new Map<string, (filePath: string, title?: string) => Promise<void>>();

export function setUploadFunction(channelId: string, fn: (filePath: string, title?: string) => Promise<void>): void {
	uploadFns.set(channelId, fn);
}

export function clearUploadFunction(channelId: string): void {
	uploadFns.delete(channelId);
}

const attachSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're sharing (shown to user)" }),
	path: Type.String({ description: "Path to the file to attach" }),
	title: Type.Optional(Type.String({ description: "Title for the file (defaults to filename)" })),
});

export function createAttachTool(channelId: string): AgentTool<typeof attachSchema> {
	return {
		name: "attach",
		label: "attach",
		description:
			"Attach a file to your response. Use this to share files, images, or documents with the user. Only files from /workspace/ can be attached.",
		parameters: attachSchema,
		execute: async (
			_toolCallId: string,
			{ path, title }: { label: string; path: string; title?: string },
			signal?: AbortSignal,
		) => {
			const uploadFn = uploadFns.get(channelId);
			if (!uploadFn) {
				throw new Error("Upload function not configured");
			}

			if (signal?.aborted) {
				throw new Error("Operation aborted");
			}

			const absolutePath = resolvePath(path);
			const fileName = title || basename(absolutePath);

			await uploadFn(absolutePath, fileName);

			return {
				content: [{ type: "text" as const, text: `Attached file: ${fileName}` }],
				details: undefined,
			};
		},
	};
}
