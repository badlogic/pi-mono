import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadTool } from "../src/core/tools/read.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-read-video-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("read tool video attachments", () => {
	it("returns a local MP4 as a base64 video tool result", async () => {
		const cwd = createTempDir();
		const path = join(cwd, "clip.mp4");
		const bytes = Buffer.from([
			0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
		]);
		writeFileSync(path, bytes);

		const result = await createReadTool(cwd).execute("read-video", { path });

		expect(result.content).toEqual([
			{ type: "text", text: "Read video file [video/mp4] (16B)" },
			{ type: "video", data: bytes.toString("base64"), mimeType: "video/mp4" },
		]);
	});

	it("rejects oversized videos before reading their contents", async () => {
		const readFile = vi.fn(async () => Buffer.alloc(0));
		const tool = createReadTool(process.cwd(), {
			operations: {
				access: async () => {},
				readFile,
				detectImageMimeType: async () => null,
				detectVideoMimeType: async () => "video/mp4",
				getSize: async () => 51 * 1024 * 1024,
			},
		});

		await expect(tool.execute("read-large-video", { path: "large.mp4" })).rejects.toThrow("exceeds 50.0MB limit");
		expect(readFile).not.toHaveBeenCalled();
	});
});
