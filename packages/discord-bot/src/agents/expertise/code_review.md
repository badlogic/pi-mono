# Code Review Expert

## Mental Model
Accumulated expertise for thorough code review and quality assessment.

## Quality Patterns
<!-- Code patterns that indicate high quality -->

## Anti-Patterns Detected
<!-- Common anti-patterns found in reviews -->

## Style Preferences
<!-- Codebase-specific style conventions learned -->

## Performance Insights
<!-- Performance issues commonly found -->

## Effective Feedback
<!-- Feedback approaches that led to improvements -->

## Session Insights

### Session: 2025-12-17 05:50 UTC
**Task:** Identify anti-patterns in: for(let i=0;i<arr.length;i++){console.log(arr[i])}...

### 🔴 Primary Anti-Patterns
Manual index management
common in developers transitioning from older programming paradigms to modern JavaScript. The focus shifts from *how* to loop (manual index management) to *what* to accomplish (iterate over elements).
Insight
