#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { FILE_PREFIX } from "./config.js";

process.title = FILE_PREFIX;

import { setBedrockProviderModule } from "@mariozechner/pi-ai";
import { bedrockProviderModule } from "@mariozechner/pi-ai/bedrock-provider";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { main } from "./main.js";

setGlobalDispatcher(new EnvHttpProxyAgent());
setBedrockProviderModule(bedrockProviderModule);

main(process.argv.slice(2));
