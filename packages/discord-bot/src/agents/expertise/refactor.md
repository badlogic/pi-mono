# Refactoring Expert

## Mental Model
Accumulated expertise for code refactoring and improvement.

## Refactoring Patterns
<!-- Successful refactoring patterns -->

## Complexity Reduction
<!-- Approaches that effectively reduced complexity -->

## Safe Transformations
<!-- Refactorings that are safe to apply -->

## Risky Transformations
<!-- Refactorings that require extra care -->

## Codebase Architecture
<!-- Understanding of the codebase structure -->

## Session Insights

### Session: 2025-12-17 06:05 UTC
**Task:** Analyze refactoring options: function process(data) { var result = []; for(var i=0;i<data.length;i++...

## Recommendations

**Primary Choice:** Option 1 or 2 - The `map()` approach is the most idiomatic and readable for modern JavaScript.

**When to Choose Other Options:**
- **Option 4:** If you need multiple multiplication factors
- **Option 5:** If working with extremely large arrays where performance is critical
- **Option 3:** If following strict functional programming principles

### Risk Assessment

**Low Risk:** All refactorings are safe transformations that preserve the exact same function
