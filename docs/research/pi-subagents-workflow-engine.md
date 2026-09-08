# Research note: `pi-subagents` workflow engine

**Evidence base.** [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents) at revision [`4745bd0e42083b2e2d6165ed70702c751cbfaca7`](https://github.com/nicobailon/pi-subagents/tree/4745bd0e42083b2e2d6165ed70702c751cbfaca7), especially [`docs/workflows.md`](https://github.com/nicobailon/pi-subagents/blob/4745bd0e42083b2e2d6165ed70702c751cbfaca7/docs/workflows.md) and [`src/extension/public-execution.ts`](https://github.com/nicobailon/pi-subagents/blob/4745bd0e42083b2e2d6165ed70702c751cbfaca7/src/extension/public-execution.ts). “Fact” means directly documented or implemented; “Inference” is a design conclusion from those facts; “Open question” identifies work needed before building a similar tool.

## Public execution model

- **Fact:** The `subagent` tool accepts either one direct child through `{ agent, task }` or a JavaScript `workflowScript`. Legacy public fields for chains, task arrays, parallelism, and concurrency are rejected before execution. Management actions use the same tool but follow a separate normalization path.
- **Fact:** A workflow script is an ordinary JavaScript statement body with top-level `await`. It must explicitly `return` useful output.
- **Fact:** The script receives a constrained `runs` API rather than raw child processes, run directories, or session files. Child results cross the boundary as JSON data.
- **Inference:** The public language stays small by using JavaScript for control flow while the host retains ownership of child lifecycle, capabilities, persistence, and private paths.

## Core operations

### `runs.run()`

`runs.run(key, options)` launches one keyed child immediately and returns a promise:

```js
const scan = await runs.run("scan", {
  agent: "scout",
  task: "Inspect the repository"
});
return scan.output;
```

- **Fact:** Keys identify children inside the workflow and are also used for steering. Scripts do not steer by raw run ID.
- **Fact:** Returned fields include JSON-safe values such as `runId`, `ok`, `output`, and `structuredOutput`.
- **Fact:** Calling `runs.run()` starts work. There is no separate public `start` operation.

### `runs.all()`

`runs.all(items)` launches independent children concurrently and resolves to an ordered array:

```js
const reviews = await runs.all([
  { key: "api", agent: "reviewer", task: "Review the API" },
  { key: "tests", agent: "reviewer", task: "Review the tests" }
]);
return reviews.map(result => result.output);
```

- **Fact:** Result order follows input order; the return value is not a map keyed by child name.
- **Fact:** Dynamic fanout is supported by producing bounded structured data in an earlier child, validating it in JavaScript, and mapping it into `runs.all()` items.

### Sequencing

A script sequences work by awaiting one child and placing its output in a later task:

```js
const plan = await runs.run("plan", {
  agent: "scout",
  task: "Plan the migration"
});
return runs.run("implement", {
  agent: "worker",
  task: "Implement this plan:\n" + plan.output
});
```

- **Inference:** Data dependencies are explicit JavaScript values. The engine does not need a separate chain syntax or placeholder expansion model.

### Steering

`runs.steer(key, message, options)` sends input to a live keyed child:

```js
const writer = runs.run("writer", {
  agent: "worker",
  task: "Implement the change"
});
const evidence = await runs.run("evidence", {
  agent: "scout",
  task: "Find the governing contract"
});
const receipt = await runs.steer(
  "writer",
  "Also check:\n" + evidence.output,
  { mode: "follow_up" }
);
return { writer: await writer, receipt };
```

- **Fact:** Receipt states are `queued`, `delivered`, `missed`, or `failed`. Delivery means the child Pi session accepted the input, not that the model followed it.
- **Fact:** Steering promises must be observed. Fire-and-forget steering is rejected.

## Promise observation rules

- **Fact:** Every launched child must be observed through direct `await`, `return`, `Promise.all()`, or `Promise.race()`.
- **Fact:** A script may retain a child promise for rolling coordination if it later observes that promise.
- **Fact:** Nested async function declarations, async arrows, and async methods are rejected because they can hide child-launch observation under Bun. Plain helper functions that return `runs.run()` remain valid.
- **Inference:** Promise observation is a central correctness rule. It prevents a workflow from reporting completion while children continue without an owner.

## Structured output and dynamic fanout

A child may declare an output schema. Later script code reads the validated `structuredOutput`:

```js
const inventory = await runs.run("inventory", {
  agent: "scout",
  task: "Return up to five files that need review.",
  outputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: { type: "string" },
        maxItems: 5
      }
    },
    required: ["files"],
    additionalProperties: false
  }
});
return runs.all(inventory.structuredOutput.files.map((file, index) => ({
  key: "review-" + index,
  agent: "reviewer",
  task: "Review " + file
})));
```

- **Inference:** Structured output is the safe boundary for model-generated workflow shape. JavaScript still applies explicit bounds before fanout.

## Isolation and coordination

- **Fact:** Each `runs.run()` or `runs.all()` item may request a managed Git worktree. A top-level worktree default can apply to all children, and individual items may override it.
- **Fact:** Workflow children can contact the parent through a dedicated supervisor channel for decisions, interview requests, and progress updates.
- **Fact:** Nested delegation is disabled unless an agent’s resolved tools explicitly include `subagent`. A depth limit bounds recursion.
- **Fact:** Workflow traces record child completion and steering receipts. Background workflows use durable mission state; blocking workflows can show a live chat card.

## Costs of this design

A JavaScript workflow language requires more than exposing `eval` with a few functions. The host must own:

- script validation and portable runtime restrictions
- keyed child identity
- promise and steering observation
- fanout admission and recursion limits
- result serialization
- background mission persistence
- workflow traces
- cancellation, timeout, resume, and stale-run recovery
- worktree ownership and handoff
- supervisor routing

**Inference:** This design earns its complexity when callers need data-dependent sequence, rolling councils, dynamic fanout, or reusable programmatic workflows. It is unnecessary for a dispatcher whose parent model can already issue parallel tool calls and sequence later calls from returned results.

## Lessons for a future orchestration tool

1. **Keep child execution behind a narrow host API.** Scripts should never receive process handles, private run directories, or writable session internals.
2. **Require stable keys.** Human-readable keys make steering and traces understandable without exposing storage identity.
3. **Make every launch observable.** A workflow must not finish while an unowned promise can still mutate state or consume tokens.
4. **Use structured output for model-generated control data.** Validate and bound lists before dynamic fanout.
5. **Separate execution from management.** Starting work and inspecting, steering, stopping, or resuming it have different validation rules.
6. **Treat worktree ownership as part of execution.** Creation, process lifetime, result capture, and removal must share one durable record.
7. **Preserve receipts.** “Input accepted” and “model complied” are different facts.
8. **Prefer explicit JavaScript data flow over another chain format.** Sequence and fanout remain legible, but portability restrictions must be documented and enforced.

## Deliberately excluded from the first local `pi-subagents` package

The local package discussed in the accompanying design session will not initially implement `workflowScript`, chains, schedules, missions, dynamic fanout, or a workflow DSL. It will provide durable single-run lifecycle operations, role-based capability policy, native Pi child sessions, Herdr and RPC transports, bounded coordinator delegation, and deterministic worktree support.

This exclusion leaves a clean future boundary: a separate orchestration extension could compile a workflow into calls against the same durable run protocol without changing child execution or transport ownership.

## Open questions

- Which JavaScript parser or interpreter can enforce the accepted language without relying on fragile source-pattern checks?
- Should a future engine expose JavaScript directly, compile a declarative format into JavaScript, or support both?
- How should workflow state recover after the host exits while JavaScript awaits unresolved children?
- What admission policy should bound total fanout across nested workflows and independent parent sessions?
- How should a workflow reference large prior outputs without copying them repeatedly into child prompts?
- Can workflow traces remain useful without becoming a second session format?
