import { parseStreamingJson } from "./packages/ai/dist/json-parse.js";

// Test cases for partial JSON parsing
const testCases = [
    // Complete JSON
    { input: '{"name":"test","value":42}', expected: {name: "test", value: 42} },

    // Partial JSON - incomplete object
    { input: '{"name":"test","val', expected: {name: "test"} },
    { input: '{"name":"test"', expected: {name: "test"} },
    { input: '{"name":', expected: {} },
    { input: '{"', expected: {} },
    { input: '{', expected: {} },

    // Partial JSON - incomplete array
    { input: '{"items":[1,2,3', expected: {items: [1, 2, 3]} },
    { input: '{"items":[1,2,', expected: {items: [1, 2]} },
    { input: '{"items":[', expected: {items: []} },

    // Partial JSON - incomplete string
    { input: '{"message":"Hello wor', expected: {message: "Hello wor"} },

    // Empty or invalid
    { input: '', expected: {} },
    { input: null, expected: {} },
    { input: undefined, expected: {} },

    // Complex nested partial
    { input: '{"user":{"name":"John","age":30,"address":{"city":"New Y', expected: {user: {name: "John", age: 30, address: {city: "New Y"}}} },
];

console.log("Testing parseStreamingJson...\n");

let passed = 0;
let failed = 0;

for (const test of testCases) {
    const result = parseStreamingJson(test.input);
    const success = JSON.stringify(result) === JSON.stringify(test.expected);

    if (success) {
        console.log(`✅ PASS: "${test.input || '(empty)'}" -> ${JSON.stringify(result)}`);
        passed++;
    } else {
        console.log(`❌ FAIL: "${test.input || '(empty)'}"`);
        console.log(`   Expected: ${JSON.stringify(test.expected)}`);
        console.log(`   Got:      ${JSON.stringify(result)}`);
        failed++;
    }
}

console.log(`\n${passed} passed, ${failed} failed`);