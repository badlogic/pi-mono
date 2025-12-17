# Developer Expert

## Mental Model
Accumulated expertise for general development tasks.

## Patterns Learned
<!-- Agent updates this section with successful patterns -->

## Common Pitfalls
<!-- Agent updates this section with mistakes to avoid -->

## Effective Approaches
<!-- Agent updates this section with approaches that worked well -->

## Code Templates
<!-- Agent stores reusable code patterns here -->

## Session Insights
### Session: 2025-12-17 05:31 UTC
**Task:** Review this code pattern and identify if it follows best practices: const data = JSON.parse(input); ...

`const data = JSON.parse(input); return data.value;` does not follow best practices due to missing error handling, input validation, and type safety. A robust implementation should include try-catch blocks, input type checking, structure validation, and safe property access to handle invalid JSON, malformed input, and missing properties gracefully.

### Session: 2025-12-17 05:49 UTC
**Task:** Review this function for quality issues: async function fetchData(url) { const res = await fetch(url...

several critical quality issues:
of assuming success in all cases, making it unreliable for production use. I provided a comprehensive improved version with error handling, input validation, timeout protection, and meaningful error messages that follows defensive programming best practices.
Issues:**
