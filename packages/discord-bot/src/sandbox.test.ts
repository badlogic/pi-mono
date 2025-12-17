/**
 * Test file for DockerSandbox
 * Run with: tsx src/sandbox.test.ts
 */

import { DockerSandbox } from "./sandbox.js";

async function testSandbox() {
	console.log("Testing DockerSandbox...\n");
	const sandbox = new DockerSandbox();

	try {
		// Test 1: Python Hello World
		console.log("Test 1: Python Hello World");
		const pythonResult = await sandbox.runPython('print("Hello from Python!")', 10);
		console.log("Output:", pythonResult.output);
		console.log("Error:", pythonResult.error || "none");
		console.log("Exit Code:", pythonResult.exitCode);
		console.log("Execution Time:", pythonResult.executionTime, "ms\n");

		// Test 2: Bash command
		console.log("Test 2: Bash command");
		const bashResult = await sandbox.runBash('echo "Hello from Bash!" && ls -la', 10);
		console.log("Output:", bashResult.output);
		console.log("Error:", bashResult.error || "none");
		console.log("Exit Code:", bashResult.exitCode);
		console.log("Execution Time:", bashResult.executionTime, "ms\n");

		// Test 3: Node.js
		console.log("Test 3: Node.js");
		const nodeResult = await sandbox.runNode('console.log("Hello from Node!", process.version)', 10);
		console.log("Output:", nodeResult.output);
		console.log("Error:", nodeResult.error || "none");
		console.log("Exit Code:", nodeResult.exitCode);
		console.log("Execution Time:", nodeResult.executionTime, "ms\n");

		// Test 4: Python with error
		console.log("Test 4: Python with error");
		const errorResult = await sandbox.runPython("print(1/0)", 10);
		console.log("Output:", errorResult.output);
		console.log("Error:", errorResult.error || "none");
		console.log("Exit Code:", errorResult.exitCode);
		console.log("Execution Time:", errorResult.executionTime, "ms\n");

		// Test 5: Timeout test
		console.log("Test 5: Timeout test (5 second timeout)");
		const timeoutResult = await sandbox.runPython('import time; time.sleep(10); print("Done")', 5);
		console.log("Output:", timeoutResult.output);
		console.log("Error:", timeoutResult.error || "none");
		console.log("Exit Code:", timeoutResult.exitCode);
		console.log("Execution Time:", timeoutResult.executionTime, "ms\n");

		console.log("All tests completed!");

		// Cleanup
		console.log("\nCleaning up...");
		await sandbox.cleanupAll();
		console.log("Cleanup complete!");
	} catch (error) {
		console.error("Test failed:", error);
		process.exit(1);
	}
}

testSandbox();
