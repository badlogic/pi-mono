#!/usr/bin/env node
/**
 * Fabric Patterns Example
 * Demonstrates how to use the fabric patterns integration
 *
 * Usage:
 *   npm run build && node dist/agents/patterns/example.js
 */

import {
	executePattern,
	executePatternChain,
	getPatternStats,
	listPatterns,
	PatternChainPresets,
	QuickPatterns,
	syncFabricPatterns,
} from "./index.js";

async function main() {
	console.log("🎨 Fabric Patterns Integration Demo\n");

	// 1. Sync patterns
	console.log("📥 Syncing priority patterns from GitHub...");
	const { synced, errors } = await syncFabricPatterns(false, true);
	console.log(`✓ Synced ${synced} patterns`);
	if (errors.length > 0) {
		console.log(`⚠️  ${errors.length} errors:`, errors.slice(0, 3));
	}

	// 2. Check stats
	const stats = await getPatternStats();
	console.log(`\n📊 Pattern Statistics:`);
	console.log(`  Total cached: ${stats.totalCached}`);
	console.log(`  Priority cached: ${stats.priorityCached}`);
	console.log(`  Cache path: ${stats.cachePath}`);

	// 3. List patterns
	const patterns = await listPatterns();
	console.log(`\n📝 Available patterns (${patterns.length}):`);
	console.log(`  ${patterns.slice(0, 10).join(", ")}...`);

	// 4. Execute single pattern
	console.log("\n🔍 Testing single pattern execution...");
	const sampleText = `
    Artificial Intelligence is transforming healthcare through predictive diagnostics,
    personalized treatment plans, and automated administrative tasks. Machine learning
    models can analyze medical images faster than human radiologists, while natural
    language processing helps extract insights from medical records. However, challenges
    remain in data privacy, algorithmic bias, and the need for human oversight.
  `;

	console.log("\n📖 Extracting wisdom...");
	const wisdomResult = await QuickPatterns.extractWisdom(sampleText);
	if (wisdomResult.success) {
		console.log("✓ Success!");
		console.log(`  Duration: ${wisdomResult.duration}ms`);
		console.log(`  Output preview: ${wisdomResult.output.substring(0, 200)}...`);
	} else {
		console.log(`✗ Failed: ${wisdomResult.error}`);
	}

	console.log("\n📝 Creating summary...");
	const summaryResult = await QuickPatterns.summarize(sampleText);
	if (summaryResult.success) {
		console.log("✓ Success!");
		console.log(`  Duration: ${summaryResult.duration}ms`);
		console.log(`  Output preview: ${summaryResult.output.substring(0, 200)}...`);
	} else {
		console.log(`✗ Failed: ${summaryResult.error}`);
	}

	// 5. Execute pattern chain
	console.log("\n⛓️  Testing pattern chain...");
	const chainResult = await executePatternChain(PatternChainPresets.deepAnalysis(sampleText, "glm-4.5-air"));

	if (chainResult.success) {
		console.log("✓ Chain completed!");
		console.log(`  Total duration: ${chainResult.duration}ms`);
		console.log(`  Steps completed: ${chainResult.steps.length}`);
		chainResult.steps.forEach((step, i) => {
			console.log(`    ${i + 1}. ${step.pattern} (${step.duration}ms)`);
		});
		console.log(`\n  Final output preview:`);
		console.log(`  ${chainResult.output.substring(0, 300)}...`);
	} else {
		console.log(`✗ Chain failed: ${chainResult.error}`);
	}

	// 6. Custom pattern execution
	console.log("\n🎯 Testing custom pattern execution...");
	const customResult = await executePattern({
		pattern: "improve_prompt",
		input: "Write a function that sorts an array",
		model: "glm-4.6",
		maxTokens: 2000,
		context: "For a JavaScript coding interview",
	});

	if (customResult.success) {
		console.log("✓ Success!");
		console.log(`  Pattern: ${customResult.pattern}`);
		console.log(`  Duration: ${customResult.duration}ms`);
		console.log(`  Output preview: ${customResult.output.substring(0, 300)}...`);
	} else {
		console.log(`✗ Failed: ${customResult.error}`);
	}

	console.log("\n✨ Demo complete!\n");
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { main };
