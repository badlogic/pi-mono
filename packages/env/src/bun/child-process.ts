/**
 * Bun child_process implementation — same as Node.js.
 */

export type { ChildProcess, SpawnOptions } from "node:child_process";
export { exec, execSync, spawn, spawnSync } from "node:child_process";
