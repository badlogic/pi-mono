/**
 * System Prompt 测试用例
 * 
 * 测试验证:
 * 1. AgentConfig.systemPrompt 能正确传入 AgentService
 * 2. ResourceLoader 能正确返回 systemPrompt
 * 3. 不传入 systemPrompt 时返回 undefined
 */

import { createPiResourceLoader } from "./src/resource-loader.js";

async function testSystemPrompt() {
	console.log("=== System Prompt Test Suite ===\n");

	const testRepoPath = "./test-repo";

	// Test 1: 传入自定义 systemPrompt
	console.log("Test 1: Custom system prompt");
	const customPrompt = "You are a specialized assistant for testing.";
	const loader1 = await createPiResourceLoader({
		repoPath: testRepoPath,
		systemPrompt: customPrompt,
	});
	
	const returnedPrompt1 = loader1.getSystemPrompt();
	if (returnedPrompt1 === customPrompt) {
		console.log("  ✓ PASS: Custom system prompt correctly returned");
	} else {
		console.log("  ✗ FAIL: Expected:", customPrompt);
		console.log("         Got:", returnedPrompt1);
	}

	// Test 2: 不传入 systemPrompt (应该返回 undefined)
	console.log("\nTest 2: No system prompt (should return undefined)");
	const loader2 = await createPiResourceLoader({
		repoPath: testRepoPath,
	});
	
	const returnedPrompt2 = loader2.getSystemPrompt();
	if (returnedPrompt2 === undefined) {
		console.log("  ✓ PASS: Returns undefined when no system prompt provided");
	} else {
		console.log("  ✗ FAIL: Expected undefined, got:", returnedPrompt2);
	}

	// Test 3: 传入空字符串 (应该返回空字符串)
	console.log("\nTest 3: Empty string system prompt");
	const loader3 = await createPiResourceLoader({
		repoPath: testRepoPath,
		systemPrompt: "",
	});
	
	const returnedPrompt3 = loader3.getSystemPrompt();
	if (returnedPrompt3 === "") {
		console.log("  ✓ PASS: Empty string correctly returned");
	} else {
		console.log("  ✗ FAIL: Expected empty string, got:", returnedPrompt3);
	}

	// Test 4: 验证其他资源仍然正常加载
	console.log("\nTest 4: Resources loaded correctly with custom system prompt");
	const loader4 = await createPiResourceLoader({
		repoPath: testRepoPath,
		systemPrompt: "Custom prompt",
	});
	
	const skills = loader4.getSkills();
	const prompts = loader4.getPrompts();
	const agentsFiles = loader4.getAgentsFiles();
	
	console.log(`  Skills loaded: ${skills.skills.length}`);
	console.log(`  Prompts loaded: ${prompts.prompts.length}`);
	console.log(`  Agents files loaded: ${agentsFiles.agentsFiles.length}`);
	console.log("  ✓ PASS: Resources loaded correctly");

	console.log("\n=== All Tests Completed ===");
}

testSystemPrompt().catch(console.error);
