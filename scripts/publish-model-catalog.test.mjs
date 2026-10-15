import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function writeCatalog(input, allModels) {
	const providersDir = join(input, "providers");
	mkdirSync(providersDir);
	const models = Object.fromEntries(
		Object.entries(allModels).map(([providerId, providerModels]) => [
			providerId,
			Object.fromEntries(providerModels.filter((model) => model.type === "chat").map((model) => [model.id, model])),
		]),
	);
	const providerIds = Object.keys(allModels).sort();
	writeJson(join(input, "models.json"), models);
	writeJson(join(input, "models.all.json"), allModels);
	writeJson(join(input, "providers.json"), providerIds);
	for (const providerId of providerIds) {
		writeJson(join(providersDir, `${providerId}.json`), models[providerId]);
		writeJson(join(providersDir, `${providerId}.all.json`), allModels[providerId]);
	}
}

function createCatalog(prefix, openrouterModels = []) {
	const input = mkdtempSync(join(tmpdir(), prefix));
	const chatModels = Array.from({ length: 500 }, (_, index) => ({
		type: "chat",
		id: `chat-${index}`,
		provider: "anthropic",
	}));
	writeCatalog(input, {
		anthropic: chatModels,
		openai: [],
		openrouter: openrouterModels,
	});
	return input;
}

function runPublisher(args, options = {}) {
	return spawnSync(process.execPath, ["scripts/publish-model-catalog.mjs", ...args], {
		cwd: root,
		encoding: "utf8",
		...options,
	});
}

test("publishes explicit per-type and total model counts", (t) => {
	const input = createCatalog("pi-model-catalog-counts-", [
		{ type: "image", id: "shared", provider: "openrouter" },
		{ type: "classifier", id: "shared", provider: "openrouter" },
	]);
	t.after(() => rmSync(input, { recursive: true, force: true }));

	const result = runPublisher(["--input", input, "--source-commit", "test-commit", "--dry-run"]);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	const publication = JSON.parse(readFileSync(join(input, "publication.json"), "utf8"));
	assert.equal(publication.modelCount, 500);
	assert.equal(publication.chatModelCount, 500);
	assert.equal(publication.imageModelCount, 1);
	assert.equal(publication.classifierModelCount, 1);
	assert.equal(publication.totalModelCount, 502);
});

// Regression test for #9099: a mixed-API publication must not replace the catalog served to older clients.
test("publishes a mixed-API catalog without replacing the legacy client route", (t) => {
	const input = createCatalog("pi-model-catalog-input-");
	const temporaryDir = mkdtempSync(join(tmpdir(), "pi-model-catalog-publish-"));
	t.after(() => {
		rmSync(input, { recursive: true, force: true });
		rmSync(temporaryDir, { recursive: true, force: true });
	});

	const bucketDir = join(temporaryDir, "bucket");
	const indexPath = join(bucketDir, "models/v1/index.json");
	mkdirSync(join(bucketDir, "models/v1"), { recursive: true });
	const legacyEntry = {
		minimumPiVersion: "0.80.7",
		revision: `sha256-${"a".repeat(64)}`,
		sourceCommit: "legacy-commit",
		publishedAt: "2026-09-01T00:00:00.000Z",
		modelCount: 499,
	};
	writeJson(indexPath, {
		schemaVersion: 1,
		defaultRevision: `sha256-${"b".repeat(64)}`,
		catalogs: [
			legacyEntry,
			{ minimumPiVersion: "0.85.0", revision: `sha256-${"b".repeat(64)}` },
		],
	});

	const binDir = join(temporaryDir, "bin");
	mkdirSync(binDir);
	const awsPath = join(binDir, "aws");
	writeFileSync(
		awsPath,
		`#!/usr/bin/env node
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");
const [service, command, source, destination] = process.argv.slice(2);
if (service !== "s3" || command !== "cp") process.exit(2);
const objectPath = (url) => join(process.env.FAKE_R2_DIR, new URL(url).pathname.slice(1));
if (source.startsWith("s3://")) {
	const path = objectPath(source);
	if (!existsSync(path)) {
		console.error("NoSuchKey");
		process.exit(1);
	}
	copyFileSync(path, destination);
} else {
	const path = objectPath(destination);
	mkdirSync(dirname(path), { recursive: true });
	copyFileSync(source, path);
}
`,
	);
	chmodSync(awsPath, 0o755);

	const result = runPublisher(
		[
			"--input",
			input,
			"--bucket",
			"pi-artifacts",
			"--endpoint",
			"http://r2.test",
			"--source-commit",
			"mixed-api-commit",
		],
		{
			env: {
				...process.env,
				FAKE_R2_DIR: bucketDir,
				PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
			},
		},
	);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	const publication = JSON.parse(readFileSync(join(input, "publication.json"), "utf8"));
	const index = JSON.parse(readFileSync(indexPath, "utf8"));
	assert.equal(index.defaultRevision, publication.revision);
	assert.deepEqual(index.catalogs[0], legacyEntry);
	assert.equal(index.catalogs.length, 2);
	assert.equal(index.catalogs[1].minimumPiVersion, "0.85.0");
	assert.equal(index.catalogs[1].revision, publication.revision);
	assert.equal(index.catalogs[1].sourceCommit, "mixed-api-commit");
});
