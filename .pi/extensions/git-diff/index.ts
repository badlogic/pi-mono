/**
 * Git Diff Extension - Ctrl+F or /diff to view git changes
 */

import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, generateDiffString, renderDiff } from "@mariozechner/pi-coding-agent";
import { Container, Key, matchesKey, type SelectItem, SelectList, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

interface GitFile {
	status: "M" | "A" | "D" | "R" | "C" | "U" | "?";
	path: string;
	staged: boolean;
}

const STATUS_LABELS: Record<GitFile["status"], string> = {
	M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", U: "unmerged", "?": "untracked",
};
const dbg = (msg: string) => appendFileSync("/tmp/git-diff-debug.log", msg + "\n");

function parseGitStatus(output: string): GitFile[] {
	dbg(`=== parseGitStatus ===`);
	dbg(`Raw output: ${JSON.stringify(output)}`);
	const files: GitFile[] = [];
	for (const line of output.trim().split("\n").filter(Boolean)) {
		dbg(`Line: ${JSON.stringify(line)} (len=${line.length})`);
		if (line.length < 4) { dbg("  Skipped: too short"); continue; }
		const idx = line[0], wt = line[1], path = line.slice(3);
		dbg(`  idx='${idx}' wt='${wt}' path='${path}'`);
		if (idx !== " " && idx !== "?") { dbg(`  -> staged`); files.push({ status: idx as GitFile["status"], path, staged: true }); }
		if (wt !== " " && wt !== "?" && (idx === " " || idx !== wt)) { dbg(`  -> unstaged`); files.push({ status: wt as GitFile["status"], path, staged: false }); }
		if (idx === "?" && wt === "?") { dbg(`  -> untracked`); files.push({ status: "?", path, staged: false }); }
	}
	dbg(`Files: ${JSON.stringify(files)}`);
	return files;
}

class DiffViewer {
	private lines: string[];
	private offset = 0;
	private height = 20;
	onClose?: () => void;

	constructor(private theme: Theme, private path: string, diff: string) {
		this.lines = renderDiff(diff).split("\n");
	}

	handleInput(data: string): void {
		const max = Math.max(0, this.lines.length - this.height + 4);
		if (matchesKey(data, Key.escape)) this.onClose?.();
		else if (matchesKey(data, Key.up) || matchesKey(data, Key.left)) this.offset = Math.max(0, this.offset - 1);
		else if (matchesKey(data, Key.down) || matchesKey(data, Key.right)) this.offset = Math.min(max, this.offset + 1);
		else if (matchesKey(data, Key.pageUp)) this.offset = Math.max(0, this.offset - this.height);
		else if (matchesKey(data, Key.pageDown)) this.offset = Math.min(max, this.offset + this.height);
		else if (matchesKey(data, "g")) this.offset = 0;
		else if (matchesKey(data, "shift+g")) this.offset = max;
	}

	render(width: number): string[] {
		const th = this.theme, w = width - 2, out: string[] = [];
		const visible = this.lines.slice(this.offset, this.offset + this.height);
		const row = (c: string) => th.fg("border", "│") + c + " ".repeat(Math.max(0, w - visibleWidth(c))) + th.fg("border", "│");

		out.push(th.fg("border", "╭" + "─".repeat(w) + "╮"));
		out.push(row(` ${th.fg("accent", th.bold(truncateToWidth(this.path, w - 2)))}`));
		out.push(row(""));
		for (const l of visible) out.push(row(" " + truncateToWidth(l, w - 2)));
		for (let i = visible.length; i < this.height; i++) out.push(row(""));
		const info = this.lines.length > this.height ? `${this.offset + 1}-${Math.min(this.offset + this.height, this.lines.length)} of ${this.lines.length}` : `${this.lines.length} lines`;
		out.push(row(""));
		out.push(row(` ${th.fg("dim", info)}`));
		out.push(row(` ${th.fg("dim", "↑↓/←→ scroll • PgUp/PgDn • g/G • Esc")}`));
		out.push(th.fg("border", "╰" + "─".repeat(w) + "╯"));
		return out;
	}

	invalidate(): void {}
}

async function getDiff(file: GitFile, ctx: ExtensionContext, pi: ExtensionAPI): Promise<{ diff: string } | { error: string }> {
	const abs = join(ctx.cwd, file.path);

	if (file.status === "?") {
		try { return { diff: generateDiffString("", await readFile(abs, "utf-8")).diff }; }
		catch (e) { return { error: `Read failed: ${e}` }; }
	}

	if (file.status === "D") {
		const r = await pi.exec("git", ["show", `HEAD:${file.path}`], { cwd: ctx.cwd });
		return r.code === 0 ? { diff: generateDiffString(r.stdout, "").diff } : { error: `Git show failed: ${r.stderr}` };
	}

	let old = "", cur = "";
	if (file.staged) {
		const h = await pi.exec("git", ["show", `HEAD:${file.path}`], { cwd: ctx.cwd });
		old = h.code === 0 ? h.stdout : "";
		const i = await pi.exec("git", ["show", `:${file.path}`], { cwd: ctx.cwd });
		if (i.code !== 0) return { error: `Staged content failed for '${file.path}': ${i.stderr}` };
		cur = i.stdout;
	} else {
		const i = await pi.exec("git", ["show", `:${file.path}`], { cwd: ctx.cwd });
		old = i.code === 0 ? i.stdout : (await pi.exec("git", ["show", `HEAD:${file.path}`], { cwd: ctx.cwd })).stdout || "";
		try { cur = await readFile(abs, "utf-8"); }
		catch (e) { return { error: `Read failed: ${e}` }; }
	}
	return { diff: generateDiffString(old, cur).diff };
}

async function showViewer(path: string, diff: string, ctx: ExtensionContext): Promise<void> {
	await ctx.ui.custom<void>((tui, theme, _, done) => {
		const v = new DiffViewer(theme, path, diff);
		v.onClose = () => done();
		return { render: (w) => v.render(w), invalidate: () => v.invalidate(), handleInput: (d) => { v.handleInput(d); tui.requestRender(); } };
	}, { overlay: true });
}

async function showPicker(files: GitFile[], ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	const items: SelectItem[] = files.map((f, i) => ({ value: i, label: f.path, description: `${STATUS_LABELS[f.status]}${f.staged ? " (staged)" : ""}` }));

	const idx = await ctx.ui.custom<number | null>((tui, theme, _, done) => {
		const c = new Container();
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		c.addChild(new Text(`${theme.fg("accent", theme.bold("Git Changes"))} ${theme.fg("dim", `(${files.length})`)}`, 1, 0));
		const list = new SelectList(items, Math.min(items.length, 15), {
			selectedPrefix: (t) => theme.fg("accent", t), selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg(t.startsWith("modified") ? "warning" : t.startsWith("added") ? "success" : t.startsWith("deleted") ? "error" : "muted", t),
			scrollInfo: (t) => theme.fg("dim", t), noMatch: (t) => theme.fg("warning", t),
		});
		list.onSelect = (item) => done(item.value as number);
		list.onCancel = () => done(null);
		c.addChild(list);
		c.addChild(new Text(theme.fg("dim", "↑↓ nav • enter select • type filter • esc close"), 1, 0));
		c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		return { render: (w) => c.render(w), invalidate: () => c.invalidate(), handleInput: (d) => { list.handleInput(d); tui.requestRender(); } };
	}, { overlay: true });

	if (idx !== null) {
		const file = files[idx];
		const r = await getDiff(file, ctx, pi);
		if ("error" in r) ctx.ui.notify(r.error, "error");
		else if (!r.diff.trim()) ctx.ui.notify(`No changes in ${file.path}`, "info");
		else await showViewer(file.path, r.diff, ctx);
		await showPicker(files, ctx, pi);
	}
}

async function run(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	if ((await pi.exec("git", ["rev-parse", "--git-dir"], { cwd: ctx.cwd })).code !== 0) { ctx.ui.notify("Not a git repo", "error"); return; }
	const s = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd });
	if (s.code !== 0) { ctx.ui.notify(`Git failed: ${s.stderr}`, "error"); return; }
	if (!s.stdout.trim()) { ctx.ui.notify("No changes", "info"); return; }
	const files = parseGitStatus(s.stdout);
	if (!files.length) { ctx.ui.notify("No changes", "info"); return; }
	await showPicker(files, ctx, pi);
}

export default function (pi: ExtensionAPI) {
	pi.registerShortcut(Key.ctrl("f"), { description: "Git diff overlay", handler: (ctx) => run(ctx, pi) });
	pi.registerCommand("diff", { description: "Show git changes", handler: (_, ctx) => run(ctx, pi) });
}
