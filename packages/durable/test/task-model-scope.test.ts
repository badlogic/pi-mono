import { createModels } from "@earendil-works/pi-ai";
import {
	createRegistry,
	defineExtension,
	defineTask,
	Harness,
	MemoryStorage,
	type TaskModelScope,
} from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { context } from "./session-support.ts";
import { completed } from "./task-support.ts";

it("binds current model access to the exact task invocation at each phase", async () => {
	const first = createModels();
	const second = createModels();
	let current = first;
	const scopes: TaskModelScope[] = [];
	const registry = createRegistry();
	type Checkpoint = { phase: "first" } | { phase: "second" };
	const task = defineTask<null, Checkpoint, null>({
		name: "test.model-scope",
		version: 1,
		initial: () => ({ phase: "first" }),
		phases: {
			async first(_record, runtime, ctx) {
				expect(runtime.models).toBe(first);
				current = second;
				expect(runtime.models).toBe(second);
				await runtime.commit(() => ({ status: "running", checkpoint: { phase: "second" } }), ctx);
			},
			async second(_record, runtime, ctx) {
				expect(runtime.models).toBe(second);
				await runtime.commit(() => completed(null), ctx);
			},
		},
		async abort(_record, runtime, ctx) {
			await runtime.commit(() => completed(null), ctx);
		},
	});
	registry.install(defineExtension({ name: "test", tasks: [task] }));
	const harness = await Harness.open(
		new MemoryStorage(),
		{
			models: () => current,
			registry,
			taskModels(scope, models) {
				scopes.push(scope);
				return models;
			},
		},
		context,
	);
	try {
		const conversation = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
		const id = await conversation.commit(
			(tx) => tx.createTask(task, null, { ownership: { kind: "conversation" } }),
			context,
		);
		harness.resume();
		await harness.waitForTask(id, context);
		expect(scopes).toHaveLength(3);
		for (const scope of scopes) {
			expect(scope.taskId).toBe(id);
			expect(scope.conversationId).toBe(conversation.id);
			expect(scope.taskKind).toBe(task.definition.name);
			expect(scope.signal).toBeInstanceOf(AbortSignal);
			expect(Object.isFrozen(scope)).toBe(true);
		}
		expect(scopes[0].signal).toBe(scopes[1].signal);
	} finally {
		await harness.close(context);
	}
});
