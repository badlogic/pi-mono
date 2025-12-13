import type { Attachment } from "@mariozechner/pi-agent-core";
import { describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

describe("RpcClient attachments", () => {
	test("should include document attachments in prompt command payload", async () => {
		const client = new RpcClient({
			cliPath: "/dev/null",
			cwd: process.cwd(),
			env: {},
			provider: "anthropic",
			model: "claude-sonnet-4-5",
		});

		const writes: string[] = [];
		const fakeProcess = {
			stdin: {
				write: (chunk: string) => {
					writes.push(chunk);
					return true;
				},
			},
		};

		(client as unknown as { process?: typeof fakeProcess }).process = fakeProcess;

		const attachments: Attachment[] = [
			{
				id: "doc_1",
				type: "document",
				fileName: "test.pdf",
				mimeType: "application/pdf",
				size: 123,
				content: "dGVzdA==",
			},
		];

		const promptPromise = client.prompt("hello", attachments);

		// Allow send() to queue the request and write to stdin
		await Promise.resolve();

		expect(writes.length).toBe(1);
		const sent = JSON.parse(writes[0]!.trim()) as { id: string; type: string; attachments?: Attachment[] };

		expect(sent.type).toBe("prompt");
		expect(sent.attachments).toEqual(attachments);

		// Resolve the pending request
		(client as unknown as { handleLine: (line: string) => void }).handleLine(
			JSON.stringify({ type: "response", id: sent.id, command: "prompt", success: true }),
		);

		await promptPromise;
	});
});
