# Fabric Patterns Integration

This module integrates [danielmiessler/fabric](https://github.com/danielmiessler/fabric) patterns into the discord-bot. Fabric provides a collection of AI prompts designed for specific tasks like summarization, code review, wisdom extraction, and more.

## Features

- **Pattern Sync**: Fetch and cache patterns from the fabric GitHub repository
- **Local Caching**: Store patterns locally to avoid repeated API calls
- **Pattern Execution**: Run patterns through the lightweight agent
- **Pattern Chaining**: Execute multiple patterns in sequence
- **Batch Processing**: Run multiple patterns in parallel
- **Priority Patterns**: Pre-selected high-value patterns synced first

## Quick Start

### 1. Sync Patterns

```typescript
import { syncFabricPatterns, getPatternStats } from "./agents/index.js";

// Sync all patterns (downloads ~100+ patterns)
const { synced, errors } = await syncFabricPatterns();
console.log(`Synced ${synced} patterns`);

// Sync only priority patterns (18 most useful)
await syncFabricPatterns(false, true);

// Check stats
const stats = await getPatternStats();
console.log(`${stats.totalCached} patterns cached at ${stats.cachePath}`);
```

### 2. Execute Single Pattern

```typescript
import { QuickPatterns, executePattern } from "./agents/index.js";

// Using quick helpers
const result = await QuickPatterns.extractWisdom("Long article text...");
console.log(result.output);

// Using executePattern directly
const result = await executePattern({
	pattern: "summarize",
	input: "Long document to summarize...",
	model: "glm-4.6", // Optional, defaults to GLM-4.6
});

console.log(result.output);
```

### 3. Execute Pattern Chain

```typescript
import { executePatternChain, PatternChainPresets } from "./agents/index.js";

// Deep analysis chain: extract_wisdom → analyze_claims → summarize
const result = await executePatternChain(
	PatternChainPresets.deepAnalysis("Article or document text..."),
);

// Custom chain
const result = await executePatternChain({
	patterns: ["extract_insights", "improve_prompt", "write_essay"],
	input: "Topic for essay...",
	transform: (output, index) => {
		// Optional: transform output between patterns
		return output;
	},
});

console.log(`Chain completed in ${result.duration}ms`);
console.log(result.output);
```

### 4. Batch Processing

```typescript
import { executePatternBatch } from "./agents/index.js";

// Run multiple patterns in parallel
const { results, success } = await executePatternBatch(
	["summarize", "extract_wisdom", "analyze_claims"],
	"Text to analyze...",
);

results.forEach((r) => {
	console.log(`${r.pattern}: ${r.output.substring(0, 100)}...`);
});
```

## Priority Patterns

The following 18 patterns are considered high-priority and synced first:

1. **extract_wisdom** - Extract key insights and wisdom
2. **summarize** - Create comprehensive summaries
3. **analyze_claims** - Analyze and verify claims
4. **create_coding_project** - Generate project structure
5. **improve_prompt** - Enhance AI prompts
6. **write_essay** - Generate essays on topics
7. **explain_code** - Explain code functionality
8. **review_code** - Review code for issues
9. **create_summary** - Create brief summaries
10. **extract_article_wisdom** - Extract wisdom from articles
11. **extract_insights** - Extract key insights
12. **create_micro_summary** - Ultra-brief summaries
13. **analyze_prose** - Analyze writing quality
14. **analyze_paper** - Analyze research papers
15. **explain_project** - Explain project architecture
16. **create_quiz** - Generate quiz questions
17. **create_threat_model** - Security threat modeling
18. **create_security_update** - Generate security updates

## Pattern Chain Presets

Pre-configured pattern chains for common workflows:

### Deep Analysis
**Patterns**: `extract_wisdom → analyze_claims → summarize`
```typescript
PatternChainPresets.deepAnalysis(text);
```

### Content Creation
**Patterns**: `extract_insights → improve_prompt → write_essay`
```typescript
PatternChainPresets.contentCreation(topic);
```

### Code Review
**Patterns**: `explain_code → review_code → improve_prompt`
```typescript
PatternChainPresets.codeReview(code);
```

### Research
**Patterns**: `extract_article_wisdom → analyze_paper → create_summary`
```typescript
PatternChainPresets.research(article);
```

### Learning
**Patterns**: `extract_wisdom → create_quiz → summarize`
```typescript
PatternChainPresets.learning(content);
```

### Security Audit
**Patterns**: `create_threat_model → analyze_claims → create_security_update`
```typescript
PatternChainPresets.securityAudit(system);
```

## API Reference

### Sync Functions

#### `syncFabricPatterns(forceRefresh?, priorityOnly?)`
Sync patterns from GitHub
- `forceRefresh`: Force re-download cached patterns
- `priorityOnly`: Only sync priority patterns

#### `getPattern(name)`
Get a specific pattern by name

#### `listPatterns()`
List all cached patterns

#### `searchPatterns(query)`
Search patterns by name or content

#### `hasPattern(name)`
Check if pattern is cached

#### `clearPatternCache()`
Delete all cached patterns

### Execute Functions

#### `executePattern(options)`
Execute a single pattern
```typescript
interface PatternExecuteOptions {
	pattern: string;        // Pattern name
	input: string;          // User input
	model?: string;         // Model to use
	maxTokens?: number;     // Max response tokens
	timeout?: number;       // Timeout in ms
	context?: string;       // Additional context
}
```

#### `executePatternChain(options)`
Execute patterns in sequence
```typescript
interface PatternChainOptions {
	patterns: string[];     // Pattern names
	input: string;          // Initial input
	model?: string;         // Model to use
	maxTokens?: number;     // Max tokens per pattern
	timeout?: number;       // Timeout per pattern
	transform?: (output: string, index: number) => string;
}
```

#### `executePatternBatch(patterns, input, model?)`
Execute multiple patterns in parallel

#### `executePreset(preset, input, model?)`
Execute a preset chain by name

### Quick Helpers

All quick helpers accept `(input: string, model?: string)`:

- `QuickPatterns.extractWisdom(text)`
- `QuickPatterns.summarize(text)`
- `QuickPatterns.analyzeClaims(text)`
- `QuickPatterns.improvePrompt(prompt)`
- `QuickPatterns.reviewCode(code)`
- `QuickPatterns.explainCode(code)`
- `QuickPatterns.writeEssay(topic)`
- `QuickPatterns.createCodingProject(description)`
- `QuickPatterns.microSummary(text)`
- `QuickPatterns.extractInsights(text)`
- `QuickPatterns.analyzeProse(text)`
- `QuickPatterns.createQuiz(content)`
- `QuickPatterns.createThreatModel(system)`

## Environment Variables

- `GITHUB_TOKEN` - Optional GitHub token for higher API rate limits (5000/hr vs 60/hr)

## Cache Location

Patterns are cached in:
```
src/agents/patterns/cache/
├── extract_wisdom.md
├── summarize.md
├── analyze_claims.md
├── ...
└── *.meta.json (metadata files)
```

## Rate Limiting

- GitHub API: 100ms delay between requests
- Respects GitHub rate limits (60/hr unauthenticated, 5000/hr with token)
- Cached patterns avoid API calls

## Error Handling

All functions return structured results:

```typescript
interface PatternExecuteResult {
	success: boolean;
	output: string;
	error?: string;
	duration: number;
	pattern: string;
	patternInfo: PatternInfo;
}
```

## Examples

### Code Review Workflow

```typescript
import { PatternChainPresets, executePatternChain } from "./agents/index.js";

const code = `
function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price;
  }
  return total;
}
`;

const result = await executePatternChain(
	PatternChainPresets.codeReview(code),
);

console.log("Code Explanation:", result.steps[0].output);
console.log("Code Review:", result.steps[1].output);
console.log("Improvement Suggestions:", result.steps[2].output);
```

### Article Analysis

```typescript
import { QuickPatterns } from "./agents/index.js";

const article = "Long article text...";

// Parallel analysis
const [wisdom, summary, claims] = await Promise.all([
	QuickPatterns.extractWisdom(article),
	QuickPatterns.summarize(article),
	QuickPatterns.analyzeClaims(article),
]);

console.log("Wisdom:", wisdom.output);
console.log("Summary:", summary.output);
console.log("Claims Analysis:", claims.output);
```

### Custom Chain with Transform

```typescript
import { executePatternChain } from "./agents/index.js";

const result = await executePatternChain({
	patterns: ["extract_insights", "improve_prompt", "write_essay"],
	input: "The future of AI in healthcare",
	transform: (output, index) => {
		if (index === 0) {
			// Transform insights into prompt
			return `Write an essay based on these insights:\n${output}`;
		}
		return output;
	},
});
```

## Integration with Discord Bot

```typescript
// In slash command handler
import { QuickPatterns, syncFabricPatterns, listPatterns } from "./agents/index.js";

// /fabric sync
await interaction.reply("Syncing patterns...");
const { synced, errors } = await syncFabricPatterns(false, true);
await interaction.editReply(`Synced ${synced} patterns`);

// /fabric list
const patterns = await listPatterns();
await interaction.reply(`Available patterns:\n${patterns.join(", ")}`);

// /fabric run <pattern> <input>
const pattern = interaction.options.getString("pattern");
const input = interaction.options.getString("input");
const result = await executePattern({ pattern, input });
await interaction.reply(result.output.substring(0, 2000));

// /fabric wisdom <text>
const text = interaction.options.getString("text");
const result = await QuickPatterns.extractWisdom(text);
await interaction.reply(result.output);
```

## Advanced Usage

### Pattern Validation

```typescript
import { validatePattern, getSuggestedPatterns } from "./agents/index.js";

// Check if pattern exists
if (await validatePattern("summarize")) {
	// Execute pattern
}

// Get suggestions based on use case
const suggestions = getSuggestedPatterns("code review");
// Returns: ["explain_code", "review_code", "create_coding_project"]
```

### Custom Model Selection

```typescript
import { executePattern } from "./agents/index.js";

// Use different models for different patterns
const summary = await executePattern({
	pattern: "summarize",
	input: text,
	model: "glm-4.5-air", // Faster model
});

const analysis = await executePattern({
	pattern: "analyze_claims",
	input: text,
	model: "sonnet", // More capable model
});
```

### Error Recovery

```typescript
import { executePatternChain } from "./agents/index.js";

const result = await executePatternChain({
	patterns: ["extract_wisdom", "analyze_claims", "summarize"],
	input: text,
});

if (!result.success) {
	// Check which step failed
	const failedStep = result.steps.findIndex((s) => !s.success);
	console.error(`Failed at step ${failedStep}: ${result.error}`);

	// Use partial results
	const successfulSteps = result.steps.filter((s) => s.success);
	console.log("Completed steps:", successfulSteps.map((s) => s.pattern));
}
```

## Contributing

To add new patterns or presets:

1. Add pattern name to `PRIORITY_PATTERNS` in `fabric-sync.ts`
2. Create preset in `PatternChainPresets` in `pattern-executor.ts`
3. Add quick helper in `QuickPatterns` in `pattern-executor.ts`
4. Update this README

## License

This integration uses patterns from [danielmiessler/fabric](https://github.com/danielmiessler/fabric) which is MIT licensed.
