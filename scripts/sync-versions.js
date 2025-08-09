#!/usr/bin/env node

/**
 * Syncs inter-package dependency versions in the monorepo
 * Updates @mariozechner/pi-tui and @mariozechner/pi-agent versions
 * in dependent packages to match their current versions
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const packagesDir = join(process.cwd(), 'packages');

// Read current versions
const tui = JSON.parse(readFileSync(join(packagesDir, 'tui/package.json'), 'utf8'));
const agent = JSON.parse(readFileSync(join(packagesDir, 'agent/package.json'), 'utf8'));
const pods = JSON.parse(readFileSync(join(packagesDir, 'pods/package.json'), 'utf8'));

console.log('Current versions:');
console.log(`  @mariozechner/pi-tui: ${tui.version}`);
console.log(`  @mariozechner/pi-agent: ${agent.version}`);
console.log(`  @mariozechner/pi: ${pods.version}`);

// Update agent's dependency on tui
if (agent.dependencies['@mariozechner/pi-tui']) {
  const oldVersion = agent.dependencies['@mariozechner/pi-tui'];
  agent.dependencies['@mariozechner/pi-tui'] = `^${tui.version}`;
  writeFileSync(join(packagesDir, 'agent/package.json'), JSON.stringify(agent, null, '\t') + '\n');
  console.log(`\nUpdated agent's dependency on pi-tui: ${oldVersion} → ^${tui.version}`);
}

// Update pods' dependency on agent
if (pods.dependencies['@mariozechner/pi-agent']) {
  const oldVersion = pods.dependencies['@mariozechner/pi-agent'];
  pods.dependencies['@mariozechner/pi-agent'] = `^${agent.version}`;
  writeFileSync(join(packagesDir, 'pods/package.json'), JSON.stringify(pods, null, '\t') + '\n');
  console.log(`Updated pods' dependency on pi-agent: ${oldVersion} → ^${agent.version}`);
}

console.log('\n✅ Version sync complete!');