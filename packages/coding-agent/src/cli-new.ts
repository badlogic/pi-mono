#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main-new.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { main } from "./main-new.js";

main(process.argv.slice(2));
