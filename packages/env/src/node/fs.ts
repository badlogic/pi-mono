/**
 * Node.js filesystem implementation — thin re-export of built-in fs modules.
 */
export {
	accessSync,
	appendFileSync,
	chmodSync,
	closeSync,
	constants,
	createWriteStream,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";

export type { FSWatcher, Stats, WriteStream } from "node:fs";

export {
	access,
	mkdir,
	open,
	readdir,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
