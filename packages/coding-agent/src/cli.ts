#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
process.title = "pi";
process.env.PI_CODING_AGENT = "true";

import { main } from "./main.js";

main(process.argv.slice(2));
