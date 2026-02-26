/**
 * System Prompt 完整测试
 * 
 * 测试验证优先级:
 * 1. Request 传入的 systemPrompt (最高优先级)
 * 2. .pi/system-prompt.md 文件
 * 3. undefined (让框架使用默认)
 */

import { createPiResourceLoader } from "./src/resource-loader.js";

async function test() {
	console.log("=== System Prompt Priority Test ===\n");

	const testRepoPath = "./test-repo";

	// Test 1: 传入 systemPrompt 覆盖文件
	console.log("Test 1: Request system prompt overrides file");
	const requestPrompt = "You are a request-level assistant.";
	const loader1 = await createPiResourceLoader({
		repoPath: testRepoPath,
		systemPrompt: requestPrompt,
	});
	
	const result1 = loader1.getSystemPrompt();
	if (result1 === requestPrompt) {
		console.log("  ✓ PASS: Request system prompt takes priority");
	} else if (result1?.includes("Custom System Prompt from File")) {
		console.log("  ✗ FAIL: File system prompt was used instead of request");
	} else {
		console.log("  ✗ FAIL: Unexpected result:", result1?.substring(0, 50));
	}

	// Test 2: 不传入 systemPrompt，从文件读取
	console.log("\nTest 2: Load system prompt from file when not provided in request");
	const loader2 = await createPiResourceLoader({
		repoPath: testRepoPath,
	});
	
	const result2 = loader2.getSystemPrompt();
	if (result2?.includes("Custom System Prompt from File")) {
		console.log("  ✓ PASS: System prompt loaded from file");
	} else if (result2 === undefined) {
		console.log("  ✗ FAIL: No system prompt loaded (expected from file)");
	} else {
		console.log("  ✗ FAIL: Unexpected result:", result2?.substring(0, 50));
	}

	// Test 3: 空仓库（没有 system-prompt.md）
	console.log("\nTest 3: No system prompt file exists");
	const loader3 = await createPiResourceLoader({
		repoPath: "./non-existent-repo",
	});
	
	const result3 = loader3.getSystemPrompt();
	if (result3 === undefined) {
		console.log("  ✓ PASS: Returns undefined when no file exists");
	} else {
		console.log("  ✗ FAIL: Expected undefined, got:", result3?.substring(0, 50));
	}

	console.log("\n=== All Tests Completed ===");
}

test().catch(console.error);
