#!/usr/bin/env node
// Measures the extra strict flags the house tsconfig adds on top of the vendored engine's own base.
// The engine is green under its own config; the gap to the template's strictness is held as a ratchet so
// no patch silently regresses it. Run with --write to record the baseline after a deliberate improvement.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
const tsconfig = join(repoRoot, "tsconfig.json");
const baselinePath = join(repoRoot, "tools", "fence-counts.baseline.json");
const workDir = join(repoRoot, ".artifacts", "fence-counts");

const FLAGS = [
	["exactOptionalPropertyTypes", undefined],
	["noUncheckedIndexedAccess", undefined],
	["noImplicitOverride", undefined],
	["noImplicitReturns", undefined],
	["noPropertyAccessFromIndexSignature", undefined],
	["noFallthroughCasesInSwitch", undefined],
	["noUnusedLocals", undefined],
	["noUnusedParameters", undefined],
	["noUncheckedSideEffectImports", undefined],
	["allowUnreachableCode", false],
	["allowUnusedLabels", false],
];

function measure(flag, value) {
	const configPath = join(workDir, `${flag}.json`);
	const enabled = value === undefined ? true : value;
	writeFileSync(
		configPath,
		`${JSON.stringify({ extends: relative(workDir, tsconfig), compilerOptions: { [flag]: enabled } }, null, 2)}\n`,
	);
	const run = spawnSync(process.execPath, [tsc, "--noEmit", "-p", configPath], {
		cwd: repoRoot,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
	if (run.status !== 0 && !/error TS\d+/.test(output)) {
		throw new Error(`tsc failed without diagnostics (exit ${run.status}) for ${flag}:\n${output}`);
	}
	return (output.match(/error TS\d+/g) ?? []).length;
}

function measureAll() {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(workDir, { recursive: true });
	const counts = {};
	for (const [flag, value] of FLAGS) {
		counts[flag] = measure(flag, value);
		process.stderr.write(`measured ${flag}: ${counts[flag]}\n`);
	}
	return counts;
}

function gitShortHead() {
	const run = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
	return run.status === 0 ? run.stdout.trim() : "unknown";
}

if (!existsSync(join(repoRoot, "node_modules", "typescript"))) {
	process.stderr.write("typescript is not installed; run the install step first\n");
	process.exit(2);
}

const counts = measureAll();

if (process.argv.includes("--write")) {
	const baseline = { commit: gitShortHead(), measuredAt: new Date().toISOString(), flags: counts };
	writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
	process.stderr.write(`wrote ${relative(repoRoot, baselinePath)}\n`);
	process.exit(0);
}

if (!existsSync(baselinePath)) {
	process.stderr.write(`no baseline at ${relative(repoRoot, baselinePath)}; run with --write first\n`);
	process.exit(2);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
let regressions = 0;
const rows = [];
for (const [flag] of FLAGS) {
	const before = baseline.flags[flag];
	const now = counts[flag];
	const delta = now - before;
	if (delta > 0) regressions += 1;
	rows.push(`${flag.padEnd(34)} ${String(now).padStart(6)}  baseline ${String(before).padStart(6)}  ${delta === 0 ? "" : delta > 0 ? `+${delta}` : delta}`);
}
process.stdout.write(`${rows.join("\n")}\n`);
if (regressions > 0) {
	process.stderr.write(`\n${regressions} flag(s) regressed against ${relative(repoRoot, baselinePath)}\n`);
	process.exit(1);
}
process.stdout.write(`\nno regression against ${relative(repoRoot, baselinePath)} (measured at ${baseline.commit})\n`);
