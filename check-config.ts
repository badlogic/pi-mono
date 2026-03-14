import { CONFIG_DIR_NAME, APP_NAME, getAgentDir } from './packages/coding-agent/src/config.js';
console.log(JSON.stringify({CONFIG_DIR_NAME, APP_NAME, agentDir: getAgentDir()}, null, 2));
