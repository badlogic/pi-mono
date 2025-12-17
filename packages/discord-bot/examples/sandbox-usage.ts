/**
 * Example usage of the Docker Sandbox
 */

import { DockerSandbox } from "../src/sandbox.js";

async function examples() {
    const sandbox = new DockerSandbox();

    console.log("=== Docker Sandbox Examples ===\n");

    // Example 1: Simple Python calculation
    console.log("1. Python - Calculate factorial");
    const factorial = await sandbox.runPython(`
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(f"Factorial of 10 is {factorial(10)}")
`, 10);
    console.log("Result:", factorial.output.trim());
    console.log(`Time: ${factorial.executionTime}ms\n`);

    // Example 2: Bash - System info
    console.log("2. Bash - System information");
    const sysinfo = await sandbox.runBash(`
echo "Container Info:"
echo "Hostname: $(hostname)"
echo "OS: $(cat /etc/os-release | grep PRETTY_NAME)"
echo "Architecture: $(uname -m)"
echo "Available memory: $(free -h | grep Mem | awk '{print $2}')"
`, 10);
    console.log("Result:\n", sysinfo.output);
    console.log(`Time: ${sysinfo.executionTime}ms\n`);

    // Example 3: Node.js - JSON processing
    console.log("3. Node.js - JSON processing");
    const jsonProc = await sandbox.runNode(`
const data = {
    name: "Discord Bot",
    version: "1.0.0",
    features: ["Docker Sandbox", "MCP Tools", "AI Agent"]
};

console.log(JSON.stringify(data, null, 2));
console.log("\\nFeature count:", data.features.length);
`, 10);
    console.log("Result:\n", jsonProc.output);
    console.log(`Time: ${jsonProc.executionTime}ms\n`);

    // Example 4: Python - Data analysis
    console.log("4. Python - Data analysis");
    const dataAnalysis = await sandbox.runPython(`
import statistics

data = [12, 45, 67, 23, 89, 34, 56, 78, 90, 11]
print(f"Data: {data}")
print(f"Mean: {statistics.mean(data):.2f}")
print(f"Median: {statistics.median(data)}")
print(f"Std Dev: {statistics.stdev(data):.2f}")
print(f"Min: {min(data)}, Max: {max(data)}")
`, 15);
    console.log("Result:\n", dataAnalysis.output);
    console.log(`Time: ${dataAnalysis.executionTime}ms\n`);

    // Example 5: Error handling
    console.log("5. Error Handling");
    const errorTest = await sandbox.runPython(`
import sys
print("This will print to stdout")
print("This will print to stderr", file=sys.stderr)
raise ValueError("This is an intentional error!")
`, 10);
    console.log("Output:", errorTest.output);
    console.log("Error:", errorTest.error);
    console.log("Exit Code:", errorTest.exitCode);
    console.log(`Time: ${errorTest.executionTime}ms\n`);

    // Example 6: Bash - File operations
    console.log("6. Bash - File operations in workspace");
    const fileOps = await sandbox.runBash(`
echo "Creating test file"
echo "Hello from sandbox" > /tmp/test.txt
cat /tmp/test.txt
wc -l /tmp/test.txt
`, 10);
    console.log("Result:\n", fileOps.output);
    console.log(`Time: ${fileOps.executionTime}ms\n`);

    // Example 7: Node.js - Async operations
    console.log("7. Node.js - Async operations");
    const asyncOps = await sandbox.runNode(`
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("Starting async operation...");
    await delay(1000);
    console.log("After 1 second delay");
    await delay(1000);
    console.log("After 2 seconds total");
}

main().then(() => console.log("Complete!"));
`, 15);
    console.log("Result:\n", asyncOps.output);
    console.log(`Time: ${asyncOps.executionTime}ms\n`);

    // Example 8: Testing resource limits (will be restricted)
    console.log("8. Testing memory limits");
    const memTest = await sandbox.runPython(`
import sys
# Try to allocate a large list (will be limited by container)
try:
    # Attempt to allocate 512MB (container has 256MB limit)
    big_list = [0] * (64 * 1024 * 1024)  # 64M integers
    print(f"Allocated memory for {len(big_list)} integers")
except MemoryError:
    print("Memory allocation failed (as expected with limits)")
`, 15);
    console.log("Result:", memTest.output);
    console.log(`Exit Code: ${memTest.exitCode}\n`);

    // Cleanup
    console.log("Cleaning up sandbox resources...");
    await sandbox.cleanupAll();
    console.log("✓ Cleanup complete!");
}

// Run examples
examples().catch(console.error);
