# Compaction Research & Redesign

## Current Pi Compaction Implementation

### Settings (defaults)
- `reserveTokens: 16384` - Buffer to leave for new responses
- `keepRecentTokens: 20000` - How many tokens of recent messages to keep

### Trigger Conditions
1. **Threshold**: After each turn, if `contextTokens > contextWindow - reserveTokens`
2. **Overflow**: If LLM returns context overflow error, compact and retry

### Current Process
1. Find cut point by walking backwards until `keepRecentTokens` accumulated
2. Generate single summary of everything before cut point
3. If cutting mid-turn, also generate "turn prefix summary"
4. Save `CompactionEntry` with summary and `firstKeptEntryIndex`

### Current Prompt
```
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- Absolute file paths of any relevant files that were read or modified
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
```

### maxTokens for Summarization
- History summary: `0.8 * reserveTokens` (≈13K tokens)
- Turn prefix summary: `0.5 * reserveTokens` (≈8K tokens)

---

## Claude Code's Approach

### Key Differences
- Much more structured, detailed prompt
- Uses `<analysis>` tags for chain-of-thought before summary
- Uses `<summary>` tags for structured output
- 9-section format with explicit requirements
- Supports custom summarization instructions via user input

### Full Prompt (reconstructed from cli.js)

```
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
   If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [...]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages: 
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]

</summary>
</example>

There may be additional summarization instructions provided in the included context. If so, remember to follow these instructions when creating the above summary. Examples of instructions include:
<example>
## Compact Instructions
When summarizing the conversation focus on typescript code changes and also remember the mistakes you made and how you fixed them.
</example>
```

### Additional Features
- Supports custom instructions: `When you are using compact - please focus on test output and code changes. Include file reads verbatim.`
- Post-processes to extract `<analysis>` and `<summary>` sections
- Has "microcompact" for tool results (abbreviated tool outputs)

---

## OpenAI Codex's Approach

### Compaction Prompt (`codex-rs/core/templates/compact/prompt.md`)
```
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
```

### Summary Prefix (`codex-rs/core/templates/compact/summary_prefix.md`)
```
Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:
```

### Notes
- Very similar to our current prompt (likely we derived from same source)
- Supports custom `compact_prompt` override in config
- Has `experimental_compact_prompt_file` for loading from file

---

## SST OpenCode's Approach

### Compaction System Prompt (`session/prompt/compaction.txt`)
```
You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the conversation. 
Focus on information that would be helpful for continuing the conversation, including:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made

Your summary should be comprehensive enough to provide context but concise enough to be quickly understood.
```

### User Message for Compaction
```
Provide a detailed prompt for continuing our conversation above. Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next considering new session will not have access to our conversation.
```

### Short Summary Prompt (`session/prompt/summarize.txt`)
```
Summarize the following conversation into 2 sentences MAX explaining what the assistant did and why
Do not explain the user's input.
Do not speak in the third person about the assistant.
```

### Additional Features
- **Pruning**: Goes backwards through parts, after 40K tokens of tool calls, erases output of older tool calls
- **Prune thresholds**: `PRUNE_MINIMUM = 20_000`, `PRUNE_PROTECT = 40_000`
- Marks tool outputs as `compacted` with timestamp to avoid re-pruning

---

## Factory Droid's Approach (from binary strings)

### Scratchpad Feature
From extracted strings:
```
Edit the session scratchpad using multiple operations in a single call. Operations can be str_replace, insert, or overwrite commands and are applied in order. The scratchpad is working memory that persists when conversation history is compacted or summarized.
```

### Summary Guidance
```
Once you are done with the task, you can summarize the changes you made in a 1-4 sentences, don't go into too much detail.
```

### Compaction Model
Uses external model for summarization with configurable providers (Anthropic, OpenAI, generic chat completion API).

---

## Proposed Slice-Based Compaction

### Concept
Instead of summarizing the entire history in one call:
1. Segment session into slices (possibly overlapping)
2. Summarize each slice with budget = 1/10th of slice token count
3. Stitch slice summaries together into unified summary

### Benefits
- More parallelizable (summarize slices concurrently)
- Less risk of losing detail in long sessions
- Better "compression ratio" control per slice
- Overlapping slices can preserve continuity/context
- Can prioritize recent slices with larger budgets

### Proposed Algorithm

```typescript
interface SliceConfig {
  sliceTokens: number;       // Target tokens per slice (e.g., 20K)
  overlapTokens: number;     // Overlap between slices (e.g., 2K)
  compressionRatio: number;  // Summary budget as fraction of slice (e.g., 0.1)
  recentBoost: number;       // Multiplier for most recent slice budget (e.g., 2.0)
}

async function sliceBasedCompaction(
  messages: Message[],
  config: SliceConfig
): Promise<string> {
  // 1. Segment into slices
  const slices = segmentIntoSlices(messages, config.sliceTokens, config.overlapTokens);
  
  // 2. Calculate budget per slice
  const budgets = slices.map((slice, i) => {
    const base = estimateTokens(slice) * config.compressionRatio;
    // Boost recent slices
    const isRecent = i >= slices.length - 2;
    return Math.floor(isRecent ? base * config.recentBoost : base);
  });
  
  // 3. Summarize slices in parallel
  const summaries = await Promise.all(
    slices.map((slice, i) => summarizeSlice(slice, budgets[i], i, slices.length))
  );
  
  // 4. Stitch summaries together
  return stitchSummaries(summaries);
}
```

### Slice Summarization Prompt (per slice)

```
You are summarizing slice ${sliceIndex + 1} of ${totalSlices} from a coding session.

${sliceIndex === 0 ? 'This is the BEGINNING of the session.' : ''}
${sliceIndex === totalSlices - 1 ? 'This is the MOST RECENT activity.' : ''}

Summarize the key information in this slice:
- User requests and intent changes
- Files read, created, or modified (with paths)
- Key code changes or patterns
- Errors encountered and how they were resolved
- Decisions made and their rationale

${sliceIndex === totalSlices - 1 ? `
For the most recent slice, also include:
- Current work in progress
- Exact state of any pending tasks
- Next steps that were planned
` : ''}

Be precise and technical. Preserve file paths and important code snippets.
Budget: approximately ${budget} tokens.
```

### Stitching Prompt

```
You have ${summaries.length} chronological slice summaries from a coding session.
Combine them into a single coherent handoff summary for another LLM.

Requirements:
- Preserve chronological flow
- Deduplicate information that appears in overlapping sections  
- Emphasize the most recent work and next steps
- Keep all file paths and critical code snippets
- Total budget: ${totalBudget} tokens

Slice summaries:
${summaries.map((s, i) => `--- Slice ${i + 1} ---\n${s}`).join('\n\n')}
```

---

## Comparison Table

| Feature | Pi (Current) | Claude Code | OpenAI Codex | SST OpenCode |
|---------|--------------|-------------|--------------|--------------|
| Prompt detail | Basic | Very detailed | Basic | Medium |
| Structured output | No | Yes (<summary>) | No | No |
| Chain-of-thought | No | Yes (<analysis>) | No | No |
| Custom instructions | Yes | Yes | Yes (config) | No |
| Tool output pruning | No | Yes (microcompact) | No | Yes |
| Parallel summarization | No | No | No | No |
| Scratchpad/persistent memory | No | No | No | No |

---

---

## Test Harness

A CLI test tool is available at [compaction-strategies.ts](./compaction-strategies.ts) to compare strategies:

```bash
npx tsx docs/compaction-strategies.ts before-compaction
npx tsx docs/compaction-strategies.ts large-session
```

This outputs results to `compaction-results/[fixture]-[strategy].md` (in repo root) and a comparison file.

### Implemented Strategies

1. **single-shot**: Current approach, one LLM call with full transcript
2. **parallel-stitch**: Slice into chunks, summarize in parallel, LLM-merge results
3. **sequential-accumulated**: Slice into chunks, summarize each with all previous summaries as context
4. **sequential-rolling**: Slice into chunks, each call updates/rewrites the running summary

### Example Results (30K token session, 4 slices)

| Strategy | Input Tokens | Output Tokens | API Calls | Time (ms) |
|----------|-------------|---------------|-----------|-----------|
| single-shot | 35706 | 1284 | 1 | 31914 |
| parallel-stitch | 37850 | 3087 | 5 | 34010 |
| sequential-accumulated | 39136 | 2996 | 4 | 66907 |
| sequential-rolling | 38873 | 4557 | 4 | 98032 |

Observations:
- **single-shot**: Fastest, simplest, but entire context in one call
- **parallel-stitch**: Similar wall-clock (parallel), needs extra stitch call
- **sequential-accumulated**: 2x time, but each slice knows full prior context
- **sequential-rolling**: Slowest, most output (rewrites summary each time)

---

## Recommendations

### Short Term
1. **Improve prompt**: Adopt Claude Code's structured format with sections
2. **Add pruning**: Implement tool output pruning like OpenCode (mark old outputs as compacted)
3. **Better token estimation**: Use actual tokenizer instead of chars/4 heuristic

### Medium Term
1. **Slice-based compaction**: Implement parallel slice summarization
2. **Persistent scratchpad**: Add working memory that survives compaction
3. **Custom instructions**: Support user-provided compaction focus

### Long Term
1. **Semantic chunking**: Use embeddings to find natural break points
2. **Importance scoring**: Weight messages by relevance to current task
3. **Incremental compaction**: Compact older portions while keeping recent detailed
