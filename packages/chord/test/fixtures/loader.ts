// Runs the node loader outside vitest: its module runner bypasses the Node resolve hooks the loader installs.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { createHost, local, method } from "../../src/index.ts";
import { nodeLoader } from "../../src/loader.ts";

// Plugin modules live under the package so bare imports (typebox) resolve; removed afterwards.
const dir = fileURLToPath(new URL(`../.tmp-plugins-${process.pid}/`, import.meta.url));
const chord = new URL("../../src/index.ts", import.meta.url).href;

// The test's own copy of the plugin's contract: binding is by description, not object identity.
const Hello = local("t.hello", {
	version: 1,
	input: Type.Object({}),
	members: { greet: method(Type.String(), Type.String()) },
});

const facetSource = `
import { Type } from "typebox";
import { defineFacet, local, method } from ${JSON.stringify(chord)};
import { greeting } from "./greeting.ts";

const Hello = local("t.hello", {
	version: 1,
	input: Type.Object({}),
	members: { greet: method(Type.String(), Type.String()) },
});

export default defineFacet((host) => {
	host.serve(Hello, () => ({ greet: (name) => greeting + " " + name }));
});
`;

const writeGreeting = (text: string) =>
	writeFileSync(`${dir}greeting.ts`, `export const greeting = ${JSON.stringify(text)};\n`);

try {
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}facet.ts`, facetSource);
	writeGreeting("v1");
	const host = createHost({ loader: nodeLoader, onError: () => {} });
	await host.load([`${dir}facet.ts`]);
	const handle = host.get(Hello, {});
	assert.equal(await handle.greet("x"), "v1 x");
	writeGreeting("v2");
	const report = await host.reload([`${dir}facet.ts`]);
	assert.deepEqual(report.changed, ["t.hello"]);
	assert.equal(await handle.greet("x"), "v2 x");
	await host.close();
} finally {
	rmSync(dir, { recursive: true, force: true });
}
