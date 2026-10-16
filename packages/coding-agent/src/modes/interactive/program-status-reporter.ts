import type { ProgramStatus, Terminal } from "@earendil-works/pi-tui";
import { APP_NAME } from "../../config.ts";
import type { AgentSessionEvent } from "../../core/agent-session.ts";

export type BlockedStatus = { kind: NonNullable<ProgramStatus["kind"]>; message: string };

/** External busy source (e.g. live subagents). Keeps root OSC `working` without locking the turn. */
export type ActivityStatus = { message?: string };

function firstLine(text: string | undefined): string {
	return text?.split(/\r?\n/, 1)[0]?.trim() || "Error";
}

/**
 * Reports interactive-mode state to the terminal (OSC 7501): `working` during agent runs,
 * compaction, or extension activities (e.g. live subagents); `blocked` while a dialog waits for
 * the user; then `done`, `error`, or `idle` once the run settles and no activities remain.
 * Child records (with `id`) are emitted alongside the root. Messages are limited to the session
 * name, dialog titles, activity labels, and the first line of errors; prompts and assistant
 * output are never reported.
 */
export class ProgramStatusReporter {
	private readonly getTerminal: () => Terminal;
	private readonly getSessionName: () => string | undefined;
	private runActive = false;
	private compacting = false;
	/** Outcome of the current run, reported once it settles. */
	private runResult: ProgramStatus = { state: "done" };
	/** Status while no run is active. */
	private restingStatus: ProgramStatus = { state: "idle" };
	/** Open dialogs by source, in the order they opened. The most recent one is reported. */
	private readonly blocked = new Map<string, BlockedStatus>();
	/** Extension activities by source. Presence keeps root `working` after the turn settles. */
	private readonly activities = new Map<string, ActivityStatus>();
	/** Non-root OSC records keyed by id (e.g. legion/scout). */
	private readonly childRecords = new Map<string, ProgramStatus>();
	private lastRootKey: string | undefined;
	private readonly lastChildKeys = new Map<string, string>();

	constructor(getTerminal: () => Terminal, getSessionName: () => string | undefined) {
		this.getTerminal = getTerminal;
		this.getSessionName = getSessionName;
	}

	handleEvent(event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				this.runActive = true;
				this.runResult = { state: "done" };
				break;
			case "message_end":
				// The latest response decides the outcome, so a retried error is replaced by its successful retry.
				if (event.message.role !== "assistant") return;
				this.runResult =
					event.message.stopReason === "error"
						? { state: "error", message: firstLine(event.message.errorMessage) }
						: { state: "done" };
				break;
			case "compaction_start":
				this.compacting = true;
				break;
			case "compaction_end":
				this.compacting = false;
				if (this.runActive) {
					// A failed recovery compaction ends the run unless a later response succeeds.
					if (event.aborted) this.runResult = { state: "idle" };
					else if (event.errorMessage) this.runResult = { state: "error", message: firstLine(event.errorMessage) };
				} else if (event.aborted) {
					this.restingStatus = { state: "idle" };
				} else if (event.reason === "manual") {
					this.restingStatus = event.errorMessage
						? { state: "error", message: firstLine(event.errorMessage) }
						: { state: "done" };
				}
				break;
			case "agent_settled":
				this.runActive = false;
				this.restingStatus = event.aborted ? { state: "idle" } : this.runResult;
				break;
			case "session_info_changed":
				// The session name is part of working and done reports.
				break;
			default:
				return;
		}
		this.report();
	}

	/** Report `blocked` for a dialog until it is cleared with `undefined`. Reopening a source replaces it. */
	setBlocked(source: string, status: BlockedStatus | undefined): void {
		this.blocked.delete(source);
		if (status) this.blocked.set(source, status);
		this.report();
	}

	/**
	 * Report extension activity (e.g. live subagents) as root `working` until cleared with
	 * `undefined`. Reopening a source replaces it. Does not change turn idle / Esc semantics.
	 */
	setActivity(source: string, activity: ActivityStatus | undefined): void {
		this.activities.delete(source);
		if (activity) this.activities.set(source, activity);
		this.report();
	}

	/**
	 * Emit or clear a non-root OSC 7501 record. `status.id` is required. `state=clear` removes that
	 * id and every stored descendant. Does not change the root record (use {@link setActivity}).
	 */
	setProgramRecord(status: ProgramStatus & { id: string }): void {
		const id = status.id;
		if (status.state === "clear") {
			const prefix = `${id}/`;
			for (const key of [...this.childRecords.keys()]) {
				if (key === id || key.startsWith(prefix)) this.childRecords.delete(key);
			}
		} else {
			this.childRecords.set(id, { ...status });
		}
		this.report();
	}

	/** Forget the previous session's run, for example after switching sessions. */
	reset(): void {
		this.runActive = false;
		this.compacting = false;
		this.runResult = { state: "done" };
		this.restingStatus = { state: "idle" };
		this.activities.clear();
		this.childRecords.clear();
		this.report();
	}

	report(): void {
		const terminal = this.getTerminal();
		const root: ProgramStatus = { ...this.currentStatus(), app: APP_NAME };
		const rootKey = JSON.stringify(root);
		if (rootKey !== this.lastRootKey) {
			this.lastRootKey = rootKey;
			terminal.setProgramStatus(root);
		}

		const nextChildKeys = new Map<string, string>();
		for (const [id, record] of this.childRecords) {
			const status: ProgramStatus = { ...record, id, app: record.app ?? APP_NAME };
			const key = JSON.stringify(status);
			nextChildKeys.set(id, key);
			if (this.lastChildKeys.get(id) !== key) {
				terminal.setProgramStatus(status);
			}
		}
		for (const id of this.lastChildKeys.keys()) {
			if (!nextChildKeys.has(id)) {
				terminal.setProgramStatus({ state: "clear", id });
			}
		}
		this.lastChildKeys.clear();
		for (const [id, key] of nextChildKeys) this.lastChildKeys.set(id, key);
	}

	private currentStatus(): ProgramStatus {
		const blocked = [...this.blocked.values()].at(-1);
		if (blocked) return { state: "blocked", ...blocked };
		if (this.compacting) return { state: "working", message: "Compacting context" };
		const activity = [...this.activities.values()].at(-1);
		const childBusy = [...this.childRecords.values()].some(
			(record) => record.state === "working" || record.state === "blocked",
		);
		if (this.runActive || activity || childBusy) {
			return {
				state: "working",
				message: activity?.message ?? this.getSessionName(),
			};
		}
		const status = this.restingStatus;
		if (status.state === "working" || status.state === "done") return { ...status, message: this.getSessionName() };
		return status;
	}
}
