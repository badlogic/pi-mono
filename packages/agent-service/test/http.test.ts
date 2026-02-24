import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentServiceHttpServer } from "../src/http.js";
import { AgentRuntimeRegistry } from "../src/registry.js";
import { TestBackend } from "./test-backend.js";

interface HttpFixture {
	baseUrl: string;
	registry: AgentRuntimeRegistry;
	http: ReturnType<typeof createAgentServiceHttpServer>;
	backends: TestBackend[];
}

function createFixture(): HttpFixture {
	const backends: TestBackend[] = [];
	const registry = new AgentRuntimeRegistry(async () => {
		const backend = new TestBackend();
		backends.push(backend);
		return backend;
	});
	const http = createAgentServiceHttpServer(registry, {
		apiKey: "secret-key",
		heartbeatMs: 50,
	});
	return {
		baseUrl: "",
		registry,
		http,
		backends,
	};
}

async function readJson(response: Response): Promise<{ [key: string]: string | number | boolean | object | null }> {
	return (await response.json()) as { [key: string]: string | number | boolean | object | null };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
	const decoder = new TextDecoder();
	const end = Date.now() + 3000;
	let aggregate = "";
	while (Date.now() < end) {
		const chunk = await reader.read();
		if (chunk.done) {
			break;
		}
		aggregate += decoder.decode(chunk.value, { stream: true });
		if (aggregate.includes(needle)) {
			return aggregate;
		}
	}
	throw new Error(`Did not receive SSE payload containing: ${needle}`);
}

describe("HTTP API", () => {
	let fixture: HttpFixture;

	beforeEach(async () => {
		fixture = createFixture();
		await fixture.http.listen(0, "127.0.0.1");
		const address = fixture.http.server.address() as AddressInfo;
		fixture.baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		fixture.registry.dispose();
		await fixture.http.close();
	});

	it("rejects invalid API key", async () => {
		const response = await fetch(`${fixture.baseUrl}/v1/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "wrong-key",
			},
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(401);
		const body = await readJson(response);
		expect(body.code).toBe("AUTH_INVALID");
	});

	it("supports create, prompt, busy gating, steer/follow-up, abort and model errors", async () => {
		const createResponse = await fetch(`${fixture.baseUrl}/v1/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "secret-key",
			},
			body: JSON.stringify({}),
		});
		expect(createResponse.status).toBe(201);
		const created = await readJson(createResponse);
		const sessionId = created.id as string;

		const firstPrompt = await fetch(`${fixture.baseUrl}/v1/sessions/${sessionId}/prompt`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "secret-key",
			},
			body: JSON.stringify({ text: "hello" }),
		});
		expect(firstPrompt.status).toBe(202);

		const secondPrompt = await fetch(`${fixture.baseUrl}/v1/sessions/${sessionId}/prompt`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "secret-key",
			},
			body: JSON.stringify({ text: "another" }),
		});
		expect(secondPrompt.status).toBe(409);
		const secondBody = await readJson(secondPrompt);
		expect(secondBody.code).toBe("SESSION_BUSY");

		const steerResponse = await fetch(`${fixture.baseUrl}/v1/sessions/${sessionId}/steer`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "secret-key",
			},
			body: JSON.stringify({ text: "steer text" }),
		});
		expect(steerResponse.status).toBe(200);

		const followResponse = await fetch(`${fixture.baseUrl}/v1/sessions/${sessionId}/follow-up`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "secret-key",
			},
			body: JSON.stringify({ text: "follow text" }),
		});
		expect(followResponse.status).toBe(200);

		setTimeout(() => {
			fixture.backends[0]?.completeAbort();
		}, 20);
		const abortResponse = await fetch(`${fixture.baseUrl}/v1/sessions/${sessionId}/abort`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "secret-key",
			},
			body: JSON.stringify({}),
		});
		expect(abortResponse.status).toBe(200);

		const modelResponse = await fetch(`${fixture.baseUrl}/v1/sessions/${sessionId}/model`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "secret-key",
			},
			body: JSON.stringify({ provider: "anthropic", modelId: "nope" }),
		});
		expect(modelResponse.status).toBe(400);
		const modelBody = await readJson(modelResponse);
		expect(modelBody.code).toBe("MODEL_ERROR");
	});

	it("streams SSE events with monotonic sequence IDs", async () => {
		const createResponse = await fetch(`${fixture.baseUrl}/v1/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "secret-key",
			},
			body: JSON.stringify({}),
		});
		const created = await readJson(createResponse);
		const sessionId = created.id as string;

		const eventStream = await fetch(`${fixture.baseUrl}/v1/sessions/${sessionId}/events/stream`, {
			headers: {
				"x-api-key": "secret-key",
			},
		});
		expect(eventStream.status).toBe(200);
		expect(eventStream.body).not.toBeNull();
		const reader = eventStream.body!.getReader();

		await fetch(`${fixture.baseUrl}/v1/sessions/${sessionId}/prompt`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "secret-key",
			},
			body: JSON.stringify({ text: "trigger stream" }),
		});

		const streamText = await readUntil(reader, '"type":"agent_start"');
		expect(streamText).toContain("event: session_event");
		expect(streamText).toContain('"seq":1');

		fixture.backends[0]?.completePrompt();
		await reader.cancel();
	});
});
