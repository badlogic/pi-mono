# Tool Output Truncation

## Limits

- **Line limit**: 2000 lines
- **Byte limit**: 30KB
- **Grep line limit**: 500 chars per match line

Whichever limit is hit first wins. **Never return partial lines** (except bash edge case).

---

## read

Head truncation (first N lines). Has offset/limit params for continuation.

### Scenarios

**First line > 30KB:**
```
LLM sees:
[Line 1 is 50KB, exceeds 30KB limit. Use bash to read: head -c 30000 path/to/file]

Details:
{ truncation: { truncated: true, truncatedBy: "bytes", outputLines: 0, ... } }
```

**Hit line limit (2000 lines, < 30KB):**
```
LLM sees:
[lines 1-2000 content]

[Showing lines 1-2000 of 5000. Use offset=2001 to continue]

Details:
{ truncation: { truncated: true, truncatedBy: "lines", outputLines: 2000, totalLines: 5000 } }
```

**Hit byte limit (< 2000 lines, 30KB):**
```
LLM sees:
[lines 1-500 content]

[Showing lines 1-500 of 5000 (30KB limit). Use offset=501 to continue]

Details:
{ truncation: { truncated: true, truncatedBy: "bytes", outputLines: 500, totalLines: 5000 } }
```

**With offset, hit line limit (e.g., offset=1000):**
```
LLM sees:
[lines 1000-2999 content]

[Showing lines 1000-2999 of 5000. Use offset=3000 to continue]

Details:
{ truncation: { truncatedBy: "lines", ... } }
```

**With offset, hit byte limit (e.g., offset=1000, 30KB after 500 lines):**
```
LLM sees:
[lines 1000-1499 content]

[Showing lines 1000-1499 of 5000 (30KB limit). Use offset=1500 to continue]

Details:
{ truncation: { truncatedBy: "bytes", outputLines: 500, ... } }
```

**With offset, first line at offset > 30KB (e.g., offset=1000, line 1000 is 50KB):**
```
LLM sees:
[Line 1000 is 50KB, exceeds 30KB limit. Use bash: sed -n '1000p' file | head -c 30000]

Details:
{ truncation: { truncated: true, truncatedBy: "bytes", outputLines: 0 } }
```

---

## bash

Tail truncation (last N lines). Writes full output to temp file if truncated.

### Scenarios

**Hit line limit (2000 lines):**
```
LLM sees:
[lines 48001-50000 content]

[Showing lines 48001-50000 of 50000. Full output: /tmp/pi-bash-xxx.log]

Details:
{ truncation: { truncated: true, truncatedBy: "lines", outputLines: 2000, totalLines: 50000 }, fullOutputPath: "/tmp/..." }
```

**Hit byte limit (< 2000 lines, 30KB):**
```
LLM sees:
[lines 49501-50000 content]

[Showing lines 49501-50000 of 50000 (30KB limit). Full output: /tmp/pi-bash-xxx.log]

Details:
{ truncation: { truncatedBy: "bytes", ... }, fullOutputPath: "/tmp/..." }
```

**Last line alone > 30KB (edge case, partial OK here):**
```
LLM sees:
[last 30KB of final line]

[Showing last 30KB of line 50000 (line is 100KB). Full output: /tmp/pi-bash-xxx.log]

Details:
{ truncation: { truncatedBy: "bytes", lastLinePartial: true }, fullOutputPath: "/tmp/..." }
```

---

## grep

Head truncation. Primary limit: 100 matches. Each match line truncated to 500 chars.

### Scenarios

**Hit match limit (100 matches):**
```
LLM sees:
file.ts:10: matching content here...
file.ts:25: another match...
...

[100 matches limit reached. Use limit=200 for more, or refine pattern]

Details:
{ matchLimitReached: 100 }
```

**Hit byte limit (< 100 matches, 30KB):**
```
LLM sees:
[matches that fit in 30KB]

[30KB limit reached (50 of 100+ matches shown)]

Details:
{ truncation: { truncatedBy: "bytes", ... } }
```

**Match lines truncated (any line > 500 chars):**
```
LLM sees:
file.ts:10: very long matching content that exceeds 500 chars gets cut off here... [truncated]
file.ts:25: normal match

[Some lines truncated to 500 chars. Use read tool to see full lines]

Details:
{ linesTruncated: true }
```

---

## find

Head truncation. Primary limit: 1000 results. File paths only (never > 30KB each).

### Scenarios

**Hit result limit (1000 results):**
```
LLM sees:
src/file1.ts
src/file2.ts
[998 more paths]

[1000 results limit reached. Use limit=2000 for more, or refine pattern]

Details:
{ resultLimitReached: 1000 }
```

**Hit byte limit (unlikely, < 1000 results, 30KB):**
```
LLM sees:
[paths that fit]

[30KB limit reached]

Details:
{ truncation: { truncatedBy: "bytes", ... } }
```

---

## ls

Head truncation. Primary limit: 500 entries. Entry names only (never > 30KB each).

### Scenarios

**Hit entry limit (500 entries):**
```
LLM sees:
.gitignore
README.md
src/
[497 more entries]

[500 entries limit reached. Use limit=1000 for more]

Details:
{ entryLimitReached: 500 }
```

**Hit byte limit (unlikely):**
```
LLM sees:
[entries that fit]

[30KB limit reached]

Details:
{ truncation: { truncatedBy: "bytes", ... } }
```

---

## TUI Display

`tool-execution.ts` reads `details.truncation` and related fields to display truncation notices in warning color. The LLM text content and TUI display show the same information.
