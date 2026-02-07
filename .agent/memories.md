# Memories

## Patterns

### mem-1770245557-134c
> Kiro image support: Added extractImages() and convertImagesToKiro() to handle ImageContent in messages. Converts base64 images to Kiro format {format: string, source: {bytes: string}}. Applied to both history user messages and current message.
<!-- tags: kiro, images | created: 2026-02-04 -->

### mem-1770245233-99a7
> Kiro placeholder tools: Added extractToolNamesFromHistory() and addPlaceholderTools() to inject placeholder tool definitions for tools referenced in history but not in current tools list. Prevents Kiro from rejecting requests with orphaned tool references.
<!-- tags: kiro, tools | created: 2026-02-04 -->

### mem-1770244620-25a6
> Kiro provider truncation: Added truncateHistory() to limit history to 850KB by removing oldest messages while preserving structure. Added truncate() helper for tool results with 250KB limit and [TRUNCATED] marker. Both support reductionFactor for dynamic adjustment during retries.
<!-- tags: kiro, truncation | created: 2026-02-04 -->

## Decisions

## Fixes

### mem-1770245403-1aef
> Kiro orphaned tool results: Added extractToolUseIdsFromHistory() and injectSyntheticToolCalls() to detect tool results referencing toolUseIds not in history (due to truncation) and inject synthetic assistant messages with placeholder tool calls. Prevents API errors from orphaned tool results.
<!-- tags: kiro, truncation, tools | created: 2026-02-04 -->

### mem-1770244838-905b
> Kiro 413 retry needs while loop wrapping entire stream logic (lines 398-768). Handle 413 inline at response check, reduce context by 0.7x, max 3 retries. Don't modify outer catch block.
<!-- tags: kiro, truncation, retry | created: 2026-02-04 -->

## Context
