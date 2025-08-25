#!/usr/bin/env tsx

import { loadModels, getModelInfo, getProviderModels, getProviderInfo, getAllProviders, supportsThinking, supportsTools } from "../src/models.js";

// Test loading models
console.log("Loading models data...");
const data = loadModels();
const providers = getAllProviders();
console.log(`Loaded ${providers.length} providers\n`);

// Test getting provider info
console.log("OpenAI provider info:");
const openai = getProviderInfo("openai");
if (openai) {
    console.log(`  Name: ${openai.name}`);
    console.log(`  NPM: ${openai.npm}`);
    console.log(`  Models: ${Object.keys(openai.models).length}`);
}

// Test getting a specific model
console.log("\nGetting info for gpt-4o:");
const gpt4o = getModelInfo("gpt-4o");
if (gpt4o) {
    console.log(`  Name: ${gpt4o.name}`);
    console.log(`  Context: ${gpt4o.limit?.context}`);
    console.log(`  Max Output: ${gpt4o.limit?.output}`);
    console.log(`  Reasoning: ${gpt4o.reasoning}`);
    console.log(`  Tool Call: ${gpt4o.tool_call}`);
}

// Test getting provider models
console.log("\nOpenAI models:");
const openaiModels = getProviderModels("openai");
console.log(`  Found ${openaiModels.length} OpenAI models`);
console.log(`  First 5: ${openaiModels.slice(0, 5).map(m => m.id).join(", ")}`);

// Test checking capabilities
console.log("\nModel capabilities:");
console.log(`  gpt-4o supports thinking: ${supportsThinking("gpt-4o")}`);
console.log(`  gpt-4o supports tools: ${supportsTools("gpt-4o")}`);
console.log(`  o1 supports thinking: ${supportsThinking("o1")}`);
console.log(`  o1 supports tools: ${supportsTools("o1")}`);
console.log(`  claude-3-5-sonnet-20241022 supports tools: ${supportsTools("claude-3-5-sonnet-20241022")}`);