#!/usr/bin/env node

/**
 * Syncs inter-package dependency versions in the monorepo
 * Updates internal @mariozechner/* package versions in dependent packages
 * to match their current versions
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const packagesDir = join(process.cwd(), 'packages');

// Read current versions
const tui = JSON.parse(readFileSync(join(packagesDir, 'tui/package.json'), 'utf8'));
const ai = JSON.parse(readFileSync(join(packagesDir, 'ai/package.json'), 'utf8'));
const agent = JSON.parse(readFileSync(join(packagesDir, 'agent/package.json'), 'utf8'));
const codingAgent = JSON.parse(readFileSync(join(packagesDir, 'coding-agent/package.json'), 'utf8'));
const pods = JSON.parse(readFileSync(join(packagesDir, 'pods/package.json'), 'utf8'));
const webUi = JSON.parse(readFileSync(join(packagesDir, 'web-ui/package.json'), 'utf8'));

console.log('Current versions:');
console.log(`  @mariozechner/pi-tui: ${tui.version}`);
console.log(`  @mariozechner/pi-ai: ${ai.version}`);
console.log(`  @mariozechner/pi-agent: ${agent.version}`);
console.log(`  @mariozechner/coding-agent: ${codingAgent.version}`);
console.log(`  @mariozechner/pi: ${pods.version}`);
console.log(`  @mariozechner/pi-web-ui: ${webUi.version}`);

// Update agent's dependencies
let agentUpdated = false;
if (agent.dependencies['@mariozechner/pi-tui']) {
  const oldVersion = agent.dependencies['@mariozechner/pi-tui'];
  agent.dependencies['@mariozechner/pi-tui'] = `^${tui.version}`;
  console.log(`\nUpdated agent's dependency on pi-tui: ${oldVersion} → ^${tui.version}`);
  agentUpdated = true;
}
if (agent.dependencies['@mariozechner/pi-ai']) {
  const oldVersion = agent.dependencies['@mariozechner/pi-ai'];
  agent.dependencies['@mariozechner/pi-ai'] = `^${ai.version}`;
  console.log(`Updated agent's dependency on pi-ai: ${oldVersion} → ^${ai.version}`);
  agentUpdated = true;
}
if (agentUpdated) {
  writeFileSync(join(packagesDir, 'agent/package.json'), JSON.stringify(agent, null, '\t') + '\n');
}

// Update coding-agent's dependencies
let codingAgentUpdated = false;
if (codingAgent.dependencies['@mariozechner/pi-ai']) {
  const oldVersion = codingAgent.dependencies['@mariozechner/pi-ai'];
  codingAgent.dependencies['@mariozechner/pi-ai'] = `^${ai.version}`;
  console.log(`Updated coding-agent's dependency on pi-ai: ${oldVersion} → ^${ai.version}`);
  codingAgentUpdated = true;
}
if (codingAgent.dependencies['@mariozechner/pi-agent']) {
  const oldVersion = codingAgent.dependencies['@mariozechner/pi-agent'];
  codingAgent.dependencies['@mariozechner/pi-agent'] = `^${agent.version}`;
  console.log(`Updated coding-agent's dependency on pi-agent: ${oldVersion} → ^${agent.version}`);
  codingAgentUpdated = true;
}
if (codingAgentUpdated) {
  writeFileSync(join(packagesDir, 'coding-agent/package.json'), JSON.stringify(codingAgent, null, '\t') + '\n');
}

// Update pods' dependency on agent
if (pods.dependencies['@mariozechner/pi-agent']) {
  const oldVersion = pods.dependencies['@mariozechner/pi-agent'];
  pods.dependencies['@mariozechner/pi-agent'] = `^${agent.version}`;
  writeFileSync(join(packagesDir, 'pods/package.json'), JSON.stringify(pods, null, '\t') + '\n');
  console.log(`Updated pods' dependency on pi-agent: ${oldVersion} → ^${agent.version}`);
}

// Update web-ui's dependency on tui
if (webUi.dependencies['@mariozechner/pi-tui']) {
  const oldVersion = webUi.dependencies['@mariozechner/pi-tui'];
  webUi.dependencies['@mariozechner/pi-tui'] = `^${tui.version}`;
  writeFileSync(join(packagesDir, 'web-ui/package.json'), JSON.stringify(webUi, null, '\t') + '\n');
  console.log(`Updated web-ui's dependency on pi-tui: ${oldVersion} → ^${tui.version}`);
}

console.log('\n✅ Version sync complete!');