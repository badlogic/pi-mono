import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const TIME_ZONE = "Europe/Berlin";
const README_PATH = "README.md";
const MARKER_START = "<!-- OSS_WEEKEND_START -->";
const MARKER_END = "<!-- OSS_WEEKEND_END -->";
const DISCORD_URL = "https://discord.com/invite/3cU7Bz4UPx";

function parseArgs(argv) {
  const options = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;

    const trimmedArg = arg.slice(2);
    const separatorIndex = trimmedArg.indexOf("=");

    if (separatorIndex === -1) {
      options[trimmedArg] = "true";
      continue;
    }

    const key = trimmedArg.slice(0, separatorIndex);
    const value = trimmedArg.slice(separatorIndex + 1);
    options[key] = value;
  }

  return options;
}

function getOption(name, cliOptions, envName, fallback) {
  const cliValue = cliOptions[name];
  if (cliValue !== undefined) return cliValue;

  const envValue = process.env[envName];
  if (envValue !== undefined && envValue !== "") return envValue;

  return fallback;
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function getBerlinParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type === "literal") continue;
    values[part.type] = part.value;
  }

  return {
    weekday: values.weekday,
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function determineAction(mode, now) {
  if (mode === "close" || mode === "open") return mode;
  if (mode !== "auto") {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const berlinNow = getBerlinParts(now);

  if (berlinNow.weekday === "Fri" && berlinNow.hour === 17 && berlinNow.minute === 0) {
    return "close";
  }

  if (berlinNow.weekday === "Mon" && berlinNow.hour === 0 && berlinNow.minute === 5) {
    return "open";
  }

  return "none";
}

function buildBanner(now) {
  const startDate = formatLongDate(now);
  const reopenDate = formatLongDate(addDays(now, 3));

  return [
    MARKER_START,
    "# 🏖️ OSS Weekend",
    "",
    `**Issue tracker reopens ${reopenDate}.**`,
    "",
    `OSS weekend runs ${startDate} through ${reopenDate}. For support, join [Discord](${DISCORD_URL}).`,
    MARKER_END,
    "",
    "---",
    "",
    "",
  ].join("\n");
}

function upsertBanner(readme, now) {
  const banner = buildBanner(now);
  const bannerPattern = new RegExp(
    `${escapeRegExp(MARKER_START)}[\\s\\S]*?${escapeRegExp(MARKER_END)}\\n\\n---\\n\\n?`,
    "m",
  );

  if (bannerPattern.test(readme)) {
    return readme.replace(bannerPattern, banner);
  }

  return `${banner}${readme}`;
}

function removeBanner(readme) {
  const bannerPattern = new RegExp(
    `^${escapeRegExp(MARKER_START)}[\\s\\S]*?${escapeRegExp(MARKER_END)}\\n\\n---\\n\\n?`,
    "m",
  );

  return readme.replace(bannerPattern, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function writeGithubOutput(output) {
  const githubOutputPath = process.env.GITHUB_OUTPUT;
  if (!githubOutputPath) return;

  const lines = Object.entries(output).map(([key, value]) => `${key}=${value}`);
  await writeFile(githubOutputPath, `${lines.join("\n")}\n`, { flag: "a" });
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2));
  const mode = getOption("mode", cliOptions, "OSS_WEEKEND_MODE", "auto");
  const dryRun = isTruthy(getOption("dry-run", cliOptions, "OSS_WEEKEND_DRY_RUN", "false"));
  const nowInput = getOption("now", cliOptions, "OSS_WEEKEND_NOW", "");
  const readmePath = getOption("readme", cliOptions, "OSS_WEEKEND_README_PATH", README_PATH);

  const now = nowInput ? new Date(nowInput) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid date: ${nowInput}`);
  }

  const action = determineAction(mode, now);
  const currentReadme = await readFile(readmePath, "utf8");

  let nextReadme = currentReadme;
  if (action === "close") nextReadme = upsertBanner(currentReadme, now);
  if (action === "open") nextReadme = removeBanner(currentReadme);

  const readmeChanged = nextReadme !== currentReadme;

  if (readmeChanged && !dryRun) {
    await writeFile(readmePath, nextReadme, "utf8");
  }

  const output = {
    action,
    dry_run: dryRun ? "true" : "false",
    readme_path: readmePath,
    readme_changed: readmeChanged ? "true" : "false",
    issue_state: action === "close" ? "disabled" : action === "open" ? "enabled" : "unchanged",
    commit_message:
      action === "close"
        ? "docs: enable OSS Weekend notice"
        : action === "open"
          ? "docs: disable OSS Weekend notice"
          : "",
    now_utc: now.toISOString(),
    now_berlin: new Intl.DateTimeFormat("sv-SE", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(now),
  };

  await writeGithubOutput(output);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
