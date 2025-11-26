import { readFileSync } from "fs";
import { resolve } from "path";
import { ArangoAdapter } from "../dist/poller/db/arango-adapter.js";

function loadConfigFromSettings() {
  const settingsPath = resolve(
    process.env.PI_CODING_AGENT_DIR ?? "./packages/coding-agent/src/poller",
    "settings.json",
  );
  const raw = readFileSync(settingsPath, "utf-8");
  const json = JSON.parse(raw);
  if (!json.poller || !json.poller.arango) {
    throw new Error(`No poller.arango block found in ${settingsPath}`);
  }
  return json.poller.arango;
}

const cfg = loadConfigFromSettings();

const logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

async function main() {
  console.log("[test] Using Arango config:", {
    url: cfg.url,
    database: cfg.database,
    messagesCollection: cfg.messagesCollection,
    hasUsername: Boolean(cfg.username),
  });

  const adapter = new ArangoAdapter(cfg, logger);
  await adapter.init();

  const inbox = await adapter.listInbox("ProjectA", 10);
  console.log("[test] listInbox(ProjectA) length:", inbox.length);
}

main().catch((err) => {
  console.error("[test] ArangoAdapter init failed:", err);
  process.exit(1);
});
