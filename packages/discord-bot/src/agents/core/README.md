# PAI Core - Personal AI Infrastructure

Implementation of the 13 PAI (Personal AI Infrastructure) principles from TAC Lesson 14, integrated with the pi-mono discord-bot agent architecture.

## Overview

PAI Core provides foundational primitives for building robust, maintainable agent systems:

- **Principles** - 13 design principles for AI infrastructure
- **Skills** - Self-contained AI capabilities with versioning
- **Hooks** - Event-driven lifecycle management
- **History** - UOCS-pattern work preservation and compound learning

## The 13 PAI Principles

### 1. Clear Thinking First
Quality outcomes depend on prompt quality. Invest in clarity.

```typescript
import { CLEAR_THINKING } from "./agents/core/index.js";

const structuredPrompt = CLEAR_THINKING.structuredPrompt({
  task: "Review code for security issues",
  context: "Authentication module",
  constraints: ["Focus on OWASP Top 10", "Check input validation"],
  outputFormat: "Markdown with ## Critical, ## High, ## Medium sections"
});

// Validate prompt quality
const { valid, issues } = CLEAR_THINKING.validatePrompt(prompt);
```

### 2. Determinism Over Flexibility
Same input = predictable output.

```typescript
import { DETERMINISM } from "./agents/core/index.js";

// Classify task
const taskType = DETERMINISM.classifyTask("Calculate fibonacci sequence");
// → "deterministic"

// Apply appropriate config
const config = taskType === "deterministic"
  ? DETERMINISM.deterministicConfig  // temperature=0
  : DETERMINISM.creativeConfig;       // temperature=0.7
```

### 3. Code Before Prompts
Use code for logic, prompts for language understanding.

```typescript
import { CODE_BEFORE_PROMPTS } from "./agents/core/index.js";

// Don't ask LLM to parse JSON
const shouldUseCode = CODE_BEFORE_PROMPTS.shouldUseCode(
  "Extract all email addresses from JSON response"
);
// → true (use code, not LLM)
```

### 4. Specification-Driven
Define expected behavior first.

```typescript
import { SPECIFICATION_DRIVEN } from "./agents/core/index.js";

const spec: TaskSpecification = {
  name: "analyze_sentiment",
  description: "Analyze sentiment of customer feedback",
  inputs: [
    { name: "text", type: "string", description: "Customer feedback text" }
  ],
  outputs: [
    { name: "sentiment", type: "string", description: "positive/negative/neutral" },
    { name: "confidence", type: "number", description: "Confidence score 0-1" }
  ],
  constraints: ["Must handle multiple languages"],
  successCriteria: ["Accuracy > 85%", "Latency < 500ms"]
};

const { valid, issues } = SPECIFICATION_DRIVEN.validateSpec(spec);
```

### 5. UNIX Philosophy
Small, focused tools that compose.

```typescript
import { UNIX_PHILOSOPHY } from "./agents/core/index.js";

// Validate tool follows UNIX principles
const { valid, violations } = UNIX_PHILOSOPHY.validateTool({
  name: "text_summarizer_and_translator_and_analyzer", // ❌ Too many responsibilities
  description: "Summarizes and translates and analyzes text",
  execute: () => {}
});
// → violations: ["Description suggests multiple responsibilities"]
```

### 6. Skills as Capabilities
Self-contained AI modules.

```typescript
import { SkillBuilder, SkillRegistry } from "./agents/core/index.js";

const skill = new SkillBuilder()
  .name("sentiment_analyzer")
  .version("1.0.0")
  .description("Analyze sentiment of text")
  .modes("fast", "accurate")
  .tags("nlp", "sentiment", "analysis")
  .validator((input) => {
    const errors = [];
    if (!input.text) errors.push("Missing text field");
    return { valid: errors.length === 0, errors };
  })
  .executor(async (input, context) => {
    const mode = context?.mode || "fast";
    // ... implementation
    return { success: true, data: { sentiment: "positive" } };
  })
  .build();

const registry = new SkillRegistry("/path/to/skills");
registry.register(skill);

// Execute skill
const result = await registry.execute("sentiment_analyzer",
  { text: "Great product!" },
  { mode: "accurate" }
);
```

### 7. Agents as Personalities
Specialized for different tasks.

Already implemented via:
- `lightweight-agent.ts` - General purpose
- `openhands-agent.ts` - Software development expert
- `expertise-manager.ts` - Learning agents (trading, coding, research)

### 8. Hooks for Automation
Event-driven state management.

```typescript
import { Hooks, BuiltInHooks, HookPipeline } from "./agents/core/index.js";

// Register hooks
Hooks.beforeExecute(BuiltInHooks.validator({
  text: "string",
  maxLength: "number"
}), { priority: "highest" });

Hooks.beforeExecute(BuiltInHooks.rateLimiter(60), { priority: "high" });

Hooks.afterExecute(BuiltInHooks.timer(), { priority: "low" });

Hooks.onError(BuiltInHooks.errorRecovery(async (ctx, error) => {
  // Fallback logic
  return fallbackResult;
}));

// Or create a pipeline
const pipeline = new HookPipeline()
  .add("pre-validate", validator)
  .add("pre-execute", rateLimit)
  .add("post-execute", logger);

const result = await pipeline.execute({ component: "agent" }, data);
```

### 9. History Preserves Work
Compound learning over time (UOCS pattern).

```typescript
import { HistoryManager, History } from "./agents/core/index.js";

const history = new HistoryManager("/path/to/data", {
  maxEntries: 1000,
  autoSave: true
});

// Add entries
history.add(History.task("agent", "Analyze code", "Code review task..."));
history.add(History.learning("agent", "Pattern discovered", "Always validate inputs"));
history.add(History.success("agent", "Task completed", "Review completed successfully"));

// Query history
const recent = history.recent(10);
const learnings = history.query({ type: "learning", limit: 5 });
const successful = history.query({ outcome: "success", after: "2025-01-01" });

// Build context from history
const context = history.buildContext({
  component: "agent",
  tags: ["code-review"],
  limit: 5
}, maxLength: 2000);

// Get statistics
const stats = history.getStats();
console.log(`Total: ${stats.total}, By type:`, stats.byType);

// Export report
const report = history.exportMarkdown();
```

### 10. Architecture > Model
Structure beats raw power.

```typescript
import { ARCHITECTURE_OVER_MODEL } from "./agents/core/index.js";

// Select pattern for task
const pattern = ARCHITECTURE_OVER_MODEL.selectPattern(
  "Analyze code, identify issues, generate fixes, and create tests"
);
// → "pipeline" (sequential steps)

// Patterns available:
// - pipeline: Chain specialized steps
// - multiAgent: Parallel agents with consensus
// - hierarchy: Router → Workers → Aggregator
// - iterative: Execute → Evaluate → Refine
```

### 11. Fail Gracefully
Handle errors without losing work.

```typescript
import { FAIL_GRACEFULLY } from "./agents/core/index.js";

const { success, result, error } = await FAIL_GRACEFULLY.withRecovery(
  async () => {
    // Primary operation
    return await riskyOperation();
  },
  {
    maxRetries: 3,
    fallback: async () => {
      // Simpler alternative
      return await safeOperation();
    },
    onError: (error) => {
      console.error("Attempt failed:", error);
    }
  }
);

if (!success) {
  console.error("All attempts failed:", error);
} else {
  console.log("Success:", result);
}
```

### 12. Observable Systems
Know what's happening.

```typescript
import { OBSERVABLE_SYSTEMS } from "./agents/core/index.js";

// Emit events
OBSERVABLE_SYSTEMS.emit({
  timestamp: new Date().toISOString(),
  level: "info",
  component: "agent",
  event: "Task started",
  data: { taskId: "123", userId: "user-1" }
});

// Wrap function for automatic observability
const observableFunction = OBSERVABLE_SYSTEMS.observable(
  async (input) => {
    // Function implementation
    return result;
  },
  "component-name"
);

// Automatic logging of start, completion, duration, errors
await observableFunction(input);
```

### 13. Composable Design
Build complex from simple.

```typescript
import { COMPOSABLE_DESIGN } from "./agents/core/index.js";

// Sequential composition: f(g(x))
const process = COMPOSABLE_DESIGN.compose.pipe(
  trimWhitespace,
  toLowerCase,
  removeSpecialChars,
  tokenize
);

const result = process(input);

// Parallel composition: [f(x), g(x)]
const results = await COMPOSABLE_DESIGN.compose.parallel(
  [analyzeSentiment, extractEntities, detectLanguage],
  text
);

// Conditional composition: condition(x) ? f(x) : g(x)
const handler = COMPOSABLE_DESIGN.compose.branch(
  (text) => text.length > 1000,
  summarizeLong,
  processShort
);
```

## Integration with Act-Learn-Reuse

PAI Core integrates seamlessly with the existing `expertise-manager.ts` system:

```typescript
import { actLearnReuse } from "./agents/expertise-manager.js";
import { HistoryManager, History } from "./agents/core/index.js";

const history = new HistoryManager("/data/agent");

const { success, output, learned } = await actLearnReuse(
  "coding",
  "Review authentication module",
  async (enhancedTask) => {
    // Record task start
    history.add(History.task("agent", "Code review", enhancedTask));

    // Execute with agent
    const result = await runAgent({ prompt: enhancedTask });

    // Record learning
    if (learned?.learned) {
      history.add(History.learning("agent", learned.insight, learned.expertiseFile));
    }

    return result;
  }
);

// Build context from history for next task
const context = history.buildContext({ component: "agent", limit: 5 });
```

## Quick Start

```typescript
import { initializePAI } from "./agents/core/index.js";

// Initialize all PAI infrastructure
const { skills, history, hooks } = initializePAI("/path/to/data");

// Register skills
skills.register(mySkill);

// Setup hooks
hooks.register("pre-execute", validator, { priority: "highest" });

// Track history
history.add(History.task("agent", "Example task", "Task details..."));

// Execute
const result = await skills.execute("my_skill", input, context);
```

## Examples

See `examples.ts` for comprehensive examples:

1. **Skill with Hooks and History** - Complete lifecycle management
2. **Act-Learn-Reuse with PAI** - Integrating learning with history
3. **Multi-Agent Pipeline** - Composing multiple skills
4. **Observable Skill with Recovery** - Error handling and observability

Run examples:

```bash
npx tsx src/agents/core/examples.ts
```

## Architecture Validation

Validate your agent design against PAI principles:

```typescript
import { validateAgentDesign } from "./agents/core/index.js";

const { valid, feedback } = validateAgentDesign({
  name: "my-agent",
  description: "Analyzes code and generates documentation",
  tools: [
    { name: "code_analyzer", description: "Analyze code quality" },
    { name: "doc_generator", description: "Generate documentation" }
  ],
  workflow: "Sequential pipeline from analysis to documentation"
});

console.log(valid ? "✅ Design follows PAI principles" : "❌ Issues found");
feedback.forEach(f => console.log(f));
```

## PAI Guide

Quick reference to all principles:

```typescript
import { PAI_GUIDE } from "./agents/core/index.js";

Object.entries(PAI_GUIDE).forEach(([num, principle]) => {
  console.log(`${num}. ${principle.name}`);
  console.log(`   ${principle.description}`);
  console.log(`   ❌ ${principle.antiPattern}`);
  console.log(`   ✅ ${principle.pattern}`);
});
```

## Built-in Hooks

PAI Core provides ready-to-use hooks:

- `BuiltInHooks.logger(component)` - Log all executions
- `BuiltInHooks.timer()` - Track execution duration
- `BuiltInHooks.validator(schema)` - Input validation
- `BuiltInHooks.rateLimiter(requestsPerMin)` - Rate limiting
- `BuiltInHooks.errorRecovery(fallback)` - Error recovery
- `BuiltInHooks.cache(ttlSeconds)` - Result caching

## File Structure

```
src/agents/core/
├── principles.ts      # 13 PAI principles implementation
├── skill.ts          # Skills system (Principle 6)
├── hooks.ts          # Hooks system (Principle 8)
├── history.ts        # History system (Principle 9)
├── index.ts          # Exports and initialization
├── examples.ts       # Integration examples
└── README.md         # This file
```

## Testing

```bash
# Type check
npm run type-check

# Run examples
npx tsx src/agents/core/examples.ts

# Run tests (when implemented)
npx vitest run src/agents/core
```

## Integration Points

PAI Core integrates with:

1. **Lightweight Agent** (`lightweight-agent.ts`) - Uses principles 1, 2, 3
2. **Expertise Manager** (`expertise-manager.ts`) - Enhances with history (Principle 9)
3. **OpenHands Agent** (`openhands-agent.ts`) - Applies skills pattern (Principle 6)
4. **MCP Tools** (`mcp-tools.ts`) - Follows UNIX philosophy (Principle 5)

## Best Practices

1. **Always validate prompts** - Use `CLEAR_THINKING.validatePrompt()`
2. **Use deterministic configs for reproducibility** - Check `DETERMINISM.classifyTask()`
3. **Register global hooks early** - Call `setupAgentHooks()` at startup
4. **Record significant work** - Use `HistoryManager` for all tasks
5. **Compose skills, don't duplicate** - Follow UNIX philosophy
6. **Track metrics** - Use `OBSERVABLE_SYSTEMS.emit()`
7. **Design for failure** - Always use `FAIL_GRACEFULLY.withRecovery()`

## Version

Current version: **1.0.0** (see `PAI_VERSION` export)

## References

- TAC Lesson 14: Personal AI Infrastructure
- UOCS (User-Owned Coding System)
- pi-mono agent patterns (`packages/mom/src/agent.ts`)
- Discord bot architecture (`packages/discord-bot/`)
