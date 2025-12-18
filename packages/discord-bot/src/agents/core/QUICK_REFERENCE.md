# PAI Core Quick Reference

One-page reference for the 13 PAI principles and common patterns.

## The 13 Principles

| # | Principle | Key Idea | Anti-Pattern | Pattern |
|---|-----------|----------|--------------|---------|
| 1 | Clear Thinking First | Quality prompts → quality outputs | Vague prompts | Structured with context/constraints |
| 2 | Determinism | Same input = same output | High temp always | temp=0 for deterministic tasks |
| 3 | Code Before Prompts | Code for logic, LLM for language | Ask LLM to parse JSON | Parse with code, interpret with LLM |
| 4 | Specification-Driven | Define behavior first | Build and hope | Specs → Tests → Implementation |
| 5 | UNIX Philosophy | Small focused tools | Monolithic do-everything | Single responsibility, composable |
| 6 | Skills as Capabilities | Self-contained AI modules | Scattered prompts | Versioned skill modules |
| 7 | Agents as Personalities | Specialized agents | One agent for all | Multiple specialists |
| 8 | Hooks for Automation | Event-driven state | Manual steps | Lifecycle hooks |
| 9 | History Preserves Work | Compound learning | Lose context each time | Structured queryable history |
| 10 | Architecture > Model | Structure beats power | Biggest model always | Right architecture + appropriate model |
| 11 | Fail Gracefully | Handle errors cleanly | Crash and restart | Retries, fallbacks, partial results |
| 12 | Observable Systems | Know what's happening | Black box | Events, logs, metrics |
| 13 | Composable Design | Build complex from simple | Tightly coupled | Pure functions, composition |

## Common Imports

```typescript
// Principles
import {
  CLEAR_THINKING,
  DETERMINISM,
  FAIL_GRACEFULLY,
  OBSERVABLE_SYSTEMS,
  COMPOSABLE_DESIGN,
} from "./agents/core/index.js";

// Skills
import {
  SkillBuilder,
  SkillRegistry,
  createSkillFromTool,
} from "./agents/core/index.js";

// Hooks
import {
  Hooks,
  BuiltInHooks,
  HookPipeline,
  globalHooks,
} from "./agents/core/index.js";

// History
import {
  HistoryManager,
  History,
} from "./agents/core/index.js";

// Quick start
import { initializePAI } from "./agents/core/index.js";
```

## Quick Patterns

### Structured Prompt

```typescript
const prompt = CLEAR_THINKING.structuredPrompt({
  task: "What to do",
  context: "Background info",
  constraints: ["Rule 1", "Rule 2"],
  outputFormat: "Markdown with ## sections"
});
```

### Deterministic Execution

```typescript
const type = DETERMINISM.classifyTask(task);
const config = type === "deterministic"
  ? DETERMINISM.deterministicConfig  // temp=0
  : DETERMINISM.creativeConfig;       // temp=0.7
```

### Create a Skill

```typescript
const skill = new SkillBuilder()
  .name("my_skill")
  .version("1.0.0")
  .description("What it does")
  .modes("fast", "accurate")
  .validator((input) => ({
    valid: !!input.data,
    errors: input.data ? [] : ["Missing data"]
  }))
  .executor(async (input, context) => ({
    success: true,
    data: processedResult
  }))
  .build();

registry.register(skill);
```

### Execute a Skill

```typescript
const result = await registry.execute(
  "skill_name",
  { input: "data" },
  { mode: "accurate", userId: "123" }
);
```

### Setup Hooks

```typescript
// Validation
Hooks.beforeExecute(
  BuiltInHooks.validator({ text: "string" }),
  { priority: "highest" }
);

// Rate limiting
Hooks.beforeExecute(
  BuiltInHooks.rateLimiter(60),
  { priority: "high" }
);

// Timing
Hooks.beforeExecute(BuiltInHooks.timer(), { priority: "high" });
Hooks.afterExecute(BuiltInHooks.timer(), { priority: "low" });

// Error recovery
Hooks.onError(BuiltInHooks.errorRecovery(async (ctx, err) => {
  return fallbackResult;
}));

// Caching
Hooks.beforeExecute(BuiltInHooks.cache(300)); // 5 min TTL
```

### Track History

```typescript
const history = new HistoryManager("/data");

// Add entries
history.add(History.task("agent", "title", "details"));
history.add(History.learning("agent", "title", "insight"));
history.add(History.success("agent", "title", "result"));

// Query
const recent = history.recent(10);
const learnings = history.query({ type: "learning" });
const successful = history.query({ outcome: "success" });

// Build context
const context = history.buildContext(
  { component: "agent", tags: ["important"] },
  maxLength: 2000
);

// Stats
const stats = history.getStats();
```

### Error Recovery

```typescript
const { success, result, error } = await FAIL_GRACEFULLY.withRecovery(
  async () => await riskyOp(),
  {
    maxRetries: 3,
    fallback: async () => await safeOp(),
    onError: (e) => console.error(e)
  }
);
```

### Observable Function

```typescript
const observable = OBSERVABLE_SYSTEMS.observable(
  async (input) => {
    // Function logic
    return result;
  },
  "component-name"
);

// Automatic logging of start/end/duration/errors
await observable(input);
```

### Composition

```typescript
// Sequential
const pipeline = COMPOSABLE_DESIGN.compose.pipe(
  step1,
  step2,
  step3
);
const result = pipeline(input);

// Parallel
const results = await COMPOSABLE_DESIGN.compose.parallel(
  [task1, task2, task3],
  input
);

// Conditional
const handler = COMPOSABLE_DESIGN.compose.branch(
  (x) => x.length > 100,
  processLong,
  processShort
);
```

## Complete Initialization

```typescript
import { initializePAI, setupAgentHooks } from "./agents/core/index.js";

// Initialize all infrastructure
const { skills, history, hooks } = initializePAI("/path/to/data");

// Setup default hooks
setupAgentHooks();

// Register skills
skills.register(mySkill);

// Track execution
history.add(History.task("component", "task", "details"));

// Execute
const result = await skills.execute("skill", input, context);

// Build context for next execution
const ctx = history.buildContext({ component: "component" });
```

## Integration with Act-Learn-Reuse

```typescript
import { actLearnReuse } from "./agents/expertise-manager.js";
import { History, HistoryManager } from "./agents/core/index.js";

const history = new HistoryManager("/data");

const { success, output, learned } = await actLearnReuse(
  "mode",
  "task",
  async (enhancedTask) => {
    // Record task
    history.add(History.task("agent", "task", enhancedTask));

    // Execute
    const result = await runAgent({ prompt: enhancedTask });

    // Record learning
    if (learned?.learned) {
      history.add(History.learning("agent", learned.insight, learned.file));
    }

    return result;
  }
);

// Build context from history
const context = history.buildContext({ component: "agent" });
```

## Skill from MCP Tool

```typescript
import { createSkillFromTool } from "./agents/core/index.js";

const mcpTool = createWebSearchTool();
const skill = createSkillFromTool(mcpTool);
registry.register(skill);

// Now usable as skill
const result = await registry.execute("web_search", { query: "PAI" });
```

## Architecture Patterns

```typescript
import { ARCHITECTURE_OVER_MODEL } from "./agents/core/index.js";

// Select pattern for task
const pattern = ARCHITECTURE_OVER_MODEL.selectPattern(
  "Analyze code, fix bugs, and generate tests"
);
// → "pipeline" (sequential steps)

// Available patterns:
// - pipeline: Chain specialized steps
// - multiAgent: Parallel agents with consensus
// - hierarchy: Router → Workers → Aggregator
// - iterative: Execute → Evaluate → Refine
```

## Validate Design

```typescript
import { validateAgentDesign } from "./agents/core/index.js";

const { valid, feedback } = validateAgentDesign({
  name: "my-agent",
  description: "What it does",
  tools: [
    { name: "tool1", description: "Does thing 1" },
    { name: "tool2", description: "Does thing 2" }
  ],
  workflow: "Sequential pipeline"
});

if (!valid) {
  feedback.forEach(f => console.log(f));
}
```

## Built-in Hooks

| Hook | Purpose | Usage |
|------|---------|-------|
| `logger(component)` | Log all executions | Debugging |
| `timer()` | Track duration | Performance |
| `validator(schema)` | Input validation | Safety |
| `rateLimiter(rpm)` | Rate limiting | Protection |
| `errorRecovery(fallback)` | Error handling | Reliability |
| `cache(ttlSec)` | Result caching | Performance |

## History Entry Types

| Type | Use Case | Helper |
|------|----------|--------|
| `task` | User requests | `History.task()` |
| `learning` | Insights captured | `History.learning()` |
| `success` | Successful outcomes | `History.success()` |
| `error` | Failures | `History.error()` |
| `decision` | Decision points | `History.decision()` |
| `context` | State snapshots | Manual |

## Common Queries

```typescript
// Recent entries
history.recent(10);

// By type
history.query({ type: "learning", limit: 5 });

// By outcome
history.query({ outcome: "success" });

// By component
history.query({ component: "agent" });

// By time range
history.query({
  after: "2025-01-01T00:00:00Z",
  before: "2025-12-31T23:59:59Z"
});

// By tags
history.query({ tags: ["important", "trading"] });

// Full-text search
history.query({ searchText: "security vulnerability" });

// Combined
history.query({
  type: "success",
  component: "agent",
  tags: ["trading"],
  after: "2025-12-01",
  limit: 10
});
```

## Hook Priority Order

1. `highest` - Critical validation (schema, auth)
2. `high` - Rate limiting, timing start
3. `normal` - Business logic (default)
4. `low` - Cleanup, timing end
5. `lowest` - Logging, metrics

## Best Practices

✅ **DO:**
- Use structured prompts for clarity
- Apply deterministic config for reproducible tasks
- Track significant work in history
- Register global hooks early
- Compose skills, don't duplicate
- Handle errors gracefully
- Emit observability events
- Use UNIX philosophy for tools

❌ **DON'T:**
- Ask LLM to parse JSON or do math
- Use high temperature for deterministic tasks
- Lose context between sessions
- Ignore error cases
- Create monolithic do-everything tools
- Skip input validation
- Hard-code prompts everywhere

## File Structure

```
src/agents/core/
├── principles.ts        # 13 principles implementation
├── skill.ts            # Skills system (Principle 6)
├── hooks.ts            # Hooks system (Principle 8)
├── history.ts          # History system (Principle 9)
├── index.ts            # Exports and quick start
├── examples.ts         # Integration examples
├── README.md           # Full documentation
├── IMPLEMENTATION.md   # Implementation summary
└── QUICK_REFERENCE.md  # This file
```

## Examples

See `examples.ts` for comprehensive examples:

```bash
npx tsx src/agents/core/examples.ts
```

## Version

**PAI Core v1.0.0**

## Further Reading

- `README.md` - Complete API documentation
- `IMPLEMENTATION.md` - Implementation details
- `examples.ts` - Working code examples
- TAC Lesson 14 - Original PAI specification
