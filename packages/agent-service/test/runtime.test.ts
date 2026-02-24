import { describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors.js";
import { AgentRuntime } from "../src/runtime.js";
import { TestBackend } from "./test-backend.js";

async function settle(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("AgentRuntime", () => {
	it("enforces busy gate and allows steer/followUp during active prompt", async () => {
		const backend = new TestBackend();
		const runtime = new AgentRuntime("runtime-1", backend);

		const first = runtime.prompt("first prompt");
		expect(first.runId.length).toBeGreaterThan(0);

		try {
			runtime.prompt("second prompt");
			expect.unreachable("expected SESSION_BUSY");
		} catch (error) {
			expect(error).toBeInstanceOf(ServiceError);
			const mapped = error as ServiceError;
			expect(mapped.code).toBe("SESSION_BUSY");
		}

		await runtime.steer("steer now");
		await runtime.followUp("follow later");
		expect(backend.steerCalls).toEqual(["steer now"]);
		expect(backend.followUpCalls).toEqual(["follow later"]);

		backend.completePrompt();
		await settle();
		const second = runtime.prompt("third prompt");
		expect(second.runId.length).toBeGreaterThan(0);
		backend.completePrompt();
	});

	it("abort is idempotent while prompt is active", async () => {
		const backend = new TestBackend();
		const runtime = new AgentRuntime("runtime-2", backend);

		runtime.prompt("will abort");
		const abortA = runtime.abort();
		const abortB = runtime.abort();

		expect(backend.abortCallCount).toBe(1);
		backend.completeAbort();
		await Promise.all([abortA, abortB]);
	});

	it("passes through newSession, switch, fork and navigateTree", async () => {
		const backend = new TestBackend();
		const runtime = new AgentRuntime("runtime-3", backend);

		const newSession = await runtime.newSession({ parentSession: "/tmp/parent.jsonl" });
		expect(newSession.cancelled).toBe(false);

		const switched = await runtime.switchSession("/tmp/target.jsonl");
		expect(switched.cancelled).toBe(false);
		expect(backend.switchCalls).toEqual(["/tmp/target.jsonl"]);

		const fork = await runtime.fork("entry-1");
		expect(fork.selectedText).toBe("forked");
		expect(fork.cancelled).toBe(false);

		const nav = await runtime.navigateTree({ targetId: "entry-2", summarize: true, label: "branch" });
		expect(nav.cancelled).toBe(false);
		expect(nav.summaryEntryId).toBe("sum-1");
		expect(backend.navigateCalls).toEqual(["entry-2"]);
	});

	it("emits monotonic sequence IDs and forwards compaction events", async () => {
		const backend = new TestBackend();
		const runtime = new AgentRuntime("runtime-4", backend);
		const received: number[] = [];
		const eventTypes: string[] = [];

		const unsubscribe = runtime.subscribe((event) => {
			received.push(event.seq);
			eventTypes.push(event.event.type);
		});

		backend.emit({ type: "agent_start" });
		backend.emit({
			type: "auto_compaction_end",
			result: undefined,
			aborted: false,
			willRetry: false,
		});
		backend.emit({ type: "agent_end", messages: [] });

		unsubscribe();
		expect(received).toEqual([1, 2, 3]);
		expect(eventTypes).toEqual(["agent_start", "auto_compaction_end", "agent_end"]);
	});

	it("returns MODEL_ERROR when selected model does not exist", async () => {
		const backend = new TestBackend();
		backend.availableModels = [{ provider: "openai", modelId: "gpt-a" }];
		const runtime = new AgentRuntime("runtime-5", backend);

		await expect(runtime.setModel("anthropic", "claude-x")).rejects.toMatchObject({ code: "MODEL_ERROR" });
	});
});
