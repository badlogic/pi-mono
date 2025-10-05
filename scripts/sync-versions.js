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
const agent = JSON.parse(readFileSync(join(packagesDir, 'agent/package.json'), 'utf8'));
const pods = JSON.parse(readFileSync(join(packagesDir, 'pods/package.json'), 'utf8'));
const webUi = JSON.parse(readFileSync(join(packagesDir, 'web-ui/package.json'), 'utf8'));
const browserExtension = JSON.parse(readFileSync(join(packagesDir, 'browser-extension/package.json'), 'utf8'));

console.log('Current versions:');
console.log(`  @mariozechner/pi-tui: ${tui.version}`);
console.log(`  @mariozechner/pi-agent: ${agent.version}`);
console.log(`  @mariozechner/pi: ${pods.version}`);
console.log(`  @mariozechner/pi-web-ui: ${webUi.version}`);
console.log(`  @mariozechner/pi-reader-extension: ${browserExtension.version}`);

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

// Update browser-extension's dependency on web-ui
if (browserExtension.dependencies['@mariozechner/pi-web-ui']) {
  const oldVersion = browserExtension.dependencies['@mariozechner/pi-web-ui'];
  browserExtension.dependencies['@mariozechner/pi-web-ui'] = `^${webUi.version}`;
  writeFileSync(join(packagesDir, 'browser-extension/package.json'), JSON.stringify(browserExtension, null, '\t') + '\n');
  console.log(`Updated browser-extension's dependency on pi-web-ui: ${oldVersion} → ^${webUi.version}`);
}

console.log('\n✅ Version sync complete!');