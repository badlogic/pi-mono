import { DialogBase, DialogContent, DialogHeader, html } from "@mariozechner/mini-lit";
import { customElement, state } from "lit/decorators.js";
import { getAppStorage } from "../storage/app-storage.js";
import type { SessionMetadata } from "../storage/types.js";
import { formatUsage } from "../utils/format.js";
import { i18n } from "../utils/i18n.js";

@customElement("session-list-dialog")
export class SessionListDialog extends DialogBase {
	@state() private sessions: SessionMetadata[] = [];
	@state() private loading = true;

	private onSelectCallback?: (sessionId: string) => void;
	private onDeleteCallback?: (sessionId: string) => void;

	protected modalWidth = "min(600px, 90vw)";
	protected modalHeight = "min(700px, 90vh)";

	static async open(onSelect: (sessionId: string) => void, onDelete?: (sessionId: string) => void) {
		const dialog = new SessionListDialog();
		dialog.onSelectCallback = onSelect;
		dialog.onDeleteCallback = onDelete;
		dialog.open();
		await dialog.loadSessions();
	}

	private async loadSessions() {
		this.loading = true;
		try {
			const storage = getAppStorage();
			if (!storage.sessions) {
				console.error("Session storage not available");
				this.sessions = [];
				return;
			}

			this.sessions = await storage.sessions.listSessions();
		} catch (err) {
			console.error("Failed to load sessions:", err);
			this.sessions = [];
		} finally {
			this.loading = false;
		}
	}

	private async handleDelete(sessionId: string, event: Event) {
		event.stopPropagation();

		if (!confirm(i18n("Delete this session?"))) {
			return;
		}

		try {
			const storage = getAppStorage();
			if (!storage.sessions) return;

			await storage.sessions.deleteSession(sessionId);
			await this.loadSessions();

			// Notify callback that session was deleted
			if (this.onDeleteCallback) {
				this.onDeleteCallback(sessionId);
			}
		} catch (err) {
			console.error("Failed to delete session:", err);
		}
	}

	private handleSelect(sessionId: string) {
		if (this.onSelectCallback) {
			this.onSelectCallback(sessionId);
		}
		this.close();
	}

	private formatDate(isoString: string): string {
		const date = new Date(isoString);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));

		if (days === 0) {
			return i18n("Today");
		} else if (days === 1) {
			return i18n("Yesterday");
		} else if (days < 7) {
			return i18n("{days} days ago").replace("{days}", days.toString());
		} else {
			return date.toLocaleDateString();
		}
	}

	protected override renderContent() {
		return html`
			${DialogContent({
				className: "h-full flex flex-col",
				children: html`
					${DialogHeader({
						title: i18n("Sessions"),
						description: i18n("Load a previous conversation"),
					})}

					<div class="flex-1 overflow-y-auto mt-4 space-y-2">
						${
							this.loading
								? html`<div class="text-center py-8 text-muted-foreground">${i18n("Loading...")}</div>`
								: this.sessions.length === 0
									? html`<div class="text-center py-8 text-muted-foreground">${i18n("No sessions yet")}</div>`
									: this.sessions.map(
											(session) => html`
											<div
												class="group flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-secondary/50 cursor-pointer transition-colors"
												@click=${() => this.handleSelect(session.id)}
											>
												<div class="flex-1 min-w-0">
													<div class="font-medium text-sm text-foreground truncate">${session.title}</div>
													<div class="text-xs text-muted-foreground mt-1">${this.formatDate(session.lastModified)}</div>
													<div class="text-xs text-muted-foreground mt-1">
														${session.messageCount} ${i18n("messages")} · ${formatUsage(session.usage)}
													</div>
												</div>
												<button
													class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-destructive transition-opacity"
													@click=${(e: Event) => this.handleDelete(session.id, e)}
													title=${i18n("Delete")}
												>
													<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
														<path d="M3 6h18"></path>
														<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
														<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
													</svg>
												</button>
											</div>
										`,
										)
						}
					</div>
				`,
			})}
		`;
	}
}
