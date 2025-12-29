import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	escapeCdataContent,
	escapeXmlAttr,
	formatFileEntry,
	getLanguageFromPath,
	processFileArguments,
} from "../src/cli/file-processor.js";

describe("file-processor", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `file-processor-test-${Date.now()}`);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("escapeXmlAttr", () => {
		test("should escape ampersands", () => {
			expect(escapeXmlAttr("foo & bar")).toBe("foo &amp; bar");
		});

		test("should escape less than", () => {
			expect(escapeXmlAttr("foo < bar")).toBe("foo &lt; bar");
		});

		test("should escape greater than", () => {
			expect(escapeXmlAttr("foo > bar")).toBe("foo &gt; bar");
		});

		test("should escape double quotes", () => {
			expect(escapeXmlAttr('foo "bar"')).toBe("foo &quot;bar&quot;");
		});

		test("should escape all special characters", () => {
			expect(escapeXmlAttr('<a href="x">b & c</a>')).toBe("&lt;a href=&quot;x&quot;&gt;b &amp; c&lt;/a&gt;");
		});
	});

	describe("escapeCdataContent", () => {
		test("should escape ]]> sequences", () => {
			expect(escapeCdataContent("foo ]]> bar")).toBe("foo ]]]]><![CDATA[> bar");
		});

		test("should escape multiple ]]> sequences", () => {
			expect(escapeCdataContent("]]>abc]]>")).toBe("]]]]><![CDATA[>abc]]]]><![CDATA[>");
		});

		test("should not modify content without ]]>", () => {
			expect(escapeCdataContent("normal content")).toBe("normal content");
		});
	});

	describe("getLanguageFromPath", () => {
		test("should return typescript for .ts files", () => {
			expect(getLanguageFromPath("file.ts")).toBe("typescript");
		});

		test("should return typescript for .tsx files", () => {
			expect(getLanguageFromPath("file.tsx")).toBe("typescript");
		});

		test("should return javascript for .js files", () => {
			expect(getLanguageFromPath("file.js")).toBe("javascript");
		});

		test("should return python for .py files", () => {
			expect(getLanguageFromPath("file.py")).toBe("python");
		});

		test("should return markdown for .md files", () => {
			expect(getLanguageFromPath("file.md")).toBe("markdown");
		});

		test("should return text for unknown extensions", () => {
			expect(getLanguageFromPath("file.xyz")).toBe("text");
		});

		test("should return makefile for Makefile files", () => {
			expect(getLanguageFromPath("Makefile")).toBe("makefile");
		});

		test("should return text for files with unknown extension", () => {
			expect(getLanguageFromPath("unknownfile")).toBe("text");
		});
	});

	describe("formatFileEntry", () => {
		test("should format file entry with CDATA", () => {
			const entry = formatFileEntry("/path/to/file.ts", "typescript", "const x = 1;");
			expect(entry).toContain('<file path="/path/to/file.ts" language="typescript">');
			expect(entry).toContain("<![CDATA[");
			expect(entry).toContain("const x = 1;");
			expect(entry).toContain("]]>");
		});

		test("should escape CDATA end sequences in content", () => {
			const entry = formatFileEntry("/path/to/file.txt", "text", "data ]]> more");
			expect(entry).toContain("data ]]]]><![CDATA[> more");
		});

		test("should escape special chars in path", () => {
			const entry = formatFileEntry("/path/<file>.txt", "text", "content");
			expect(entry).toContain('path="');
			expect(entry).toContain("&lt;file&gt;");
		});
	});

	describe("processFileArguments", () => {
		test("should wrap text file in files + CDATA with correct language", async () => {
			const filePath = join(testDir, "test.ts");
			await writeFile(filePath, "const x = 1;");

			const result = await processFileArguments([filePath]);

			expect(result.textContent).toMatch(/^<files>/);
			expect(result.textContent).toMatch(/<\/files>\n$/);
			expect(result.textContent).toContain("<![CDATA[");
			expect(result.textContent).toContain('language="typescript"');
			expect(result.textContent).toContain("const x = 1;");
			expect(result.imageAttachments).toHaveLength(0);
		});

		test("should escape content containing ]]>", async () => {
			const filePath = join(testDir, "test.txt");
			await writeFile(filePath, "data ]]> more");

			const result = await processFileArguments([filePath]);

			expect(result.textContent).toContain("]]]]><![CDATA[>");
		});

		test("should produce empty textContent for empty files", async () => {
			const filePath = join(testDir, "empty.txt");
			await writeFile(filePath, "");

			const result = await processFileArguments([filePath]);

			expect(result.textContent).toBe("");
			expect(result.imageAttachments).toHaveLength(0);
		});

		test("should handle image file with attachment and empty CDATA", async () => {
			// Create a minimal valid PNG file (8-byte signature + minimal IHDR chunk)
			const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			// IHDR chunk: length (13) + type (IHDR) + data (13 bytes) + CRC
			const ihdrLength = Buffer.from([0x00, 0x00, 0x00, 0x0d]);
			const ihdrType = Buffer.from([0x49, 0x48, 0x44, 0x52]); // IHDR
			const ihdrData = Buffer.from([
				0x00,
				0x00,
				0x00,
				0x01, // width: 1
				0x00,
				0x00,
				0x00,
				0x01, // height: 1
				0x08, // bit depth: 8
				0x02, // color type: RGB
				0x00, // compression: deflate
				0x00, // filter: adaptive
				0x00, // interlace: none
			]);
			const ihdrCrc = Buffer.from([0x90, 0x77, 0x53, 0xde]); // Precomputed CRC
			// IEND chunk
			const iendChunk = Buffer.from([
				0x00,
				0x00,
				0x00,
				0x00, // length: 0
				0x49,
				0x45,
				0x4e,
				0x44, // type: IEND
				0xae,
				0x42,
				0x60,
				0x82, // CRC
			]);
			const pngData = Buffer.concat([pngSignature, ihdrLength, ihdrType, ihdrData, ihdrCrc, iendChunk]);

			const filePath = join(testDir, "test.png");
			await writeFile(filePath, pngData);

			const result = await processFileArguments([filePath]);

			// Should have an image attachment
			expect(result.imageAttachments).toHaveLength(1);
			expect(result.imageAttachments[0].type).toBe("image");
			expect(result.imageAttachments[0].mimeType).toBe("image/png");

			// Should have file entry with empty CDATA
			expect(result.textContent).toContain("<files>");
			expect(result.textContent).toContain("<![CDATA[");
			expect(result.textContent).toContain("]]>");
			expect(result.textContent).toContain(filePath);
		});
	});
});
