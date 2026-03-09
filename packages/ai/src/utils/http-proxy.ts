/**
 * Set up HTTP proxy according to env variables for `fetch` based SDKs in Node.js.
 * Bun has builtin support for this.
 *
 * This module should be imported early by any code that needs proxy support for fetch().
 * ES modules are cached, so importing multiple times is safe - setup only runs once.
 */
type DynamicImport = (specifier: string) => Promise<unknown>;

const dynamicImport: DynamicImport = (specifier) => import(specifier);
const UNDICI_SPECIFIER = "un" + "dici";

if (typeof process !== "undefined" && process.versions?.node) {
	dynamicImport(UNDICI_SPECIFIER).then((m) => {
		const { EnvHttpProxyAgent, setGlobalDispatcher } = m as typeof import("undici");
		setGlobalDispatcher(new EnvHttpProxyAgent());
	});
}
