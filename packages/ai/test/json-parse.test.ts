import { describe, expect, it } from "vitest";
import { parseStreamingJson } from "../src/utils/json-parse.ts";

describe("parseStreamingJson", () => {
	// #10868
	it("keeps invalid \\u escapes as literal text without dropping fields", () => {
		expect(parseStreamingJson(String.raw`{"text":"\url{x}"}`)).toEqual({ text: "\\url{x}" });
		expect(parseStreamingJson(String.raw`{"path":"a.tex","content":"\usepackage{x}","mode":"w"}`)).toEqual({
			path: "a.tex",
			content: "\\usepackage{x}",
			mode: "w",
		});
	});

	it("decodes valid \\u escapes", () => {
		expect(parseStreamingJson(String.raw`{"text":"caf\u00e9 \url"}`)).toEqual({ text: "café \\url" });
	});

	it("omits a \\u escape that is cut off mid-stream", () => {
		expect(parseStreamingJson(String.raw`{"text":"ab\u00`)).toEqual({ text: "ab" });
	});
});
