/**
 * Node.js child_process implementation — thin re-export of built-in module.
 */

export type { ChildProcess, SpawnOptions } from "node:child_process";
export { exec, execSync, spawn, spawnSync } from "node:child_process";
