export type QueuedCommandSource = "builtin" | "extension";

export type PostTurnQueueItem = {
	text: string;
	mode: "steer" | "followUp";
	kind: "message" | "command";
	commandSource?: QueuedCommandSource;
	commandName?: string;
	commandArgs?: string;
};

export type PostTurnQueueOptions = {
	isStreaming: () => boolean;
	isCompacting: () => boolean;
	prompt: (text: string) => Promise<void>;
	queueUserInput: (text: string, mode: "steer" | "followUp") => Promise<void>;
	executeQueuedCommand: (item: PostTurnQueueItem) => Promise<void>;
	clearSessionQueue: () => void;
	onQueueUpdated: () => void;
	onError: (message: string) => void;
};

export class PostTurnQueue {
	private items: PostTurnQueueItem[] = [];
	private isFlushing = false;

	constructor(private options: PostTurnQueueOptions) {}

	getItems(): readonly PostTurnQueueItem[] {
		return this.items;
	}

	reset(options?: { notify?: boolean }): PostTurnQueueItem[] {
		const items = [...this.items];
		this.items = [];
		this.isFlushing = false;
		if (options?.notify ?? true) {
			this.options.onQueueUpdated();
		}
		return items;
	}

	enqueue(item: PostTurnQueueItem): void {
		this.items.push(item);
		this.options.onQueueUpdated();
	}

	async flush(options?: { willRetry?: boolean }): Promise<void> {
		if (this.items.length === 0) {
			return;
		}
		if (this.isFlushing) {
			return;
		}
		if (this.options.isStreaming() || this.options.isCompacting()) {
			return;
		}

		this.isFlushing = true;
		const snapshot = [...this.items];

		const restoreQueue = (error: unknown) => {
			this.options.clearSessionQueue();
			const extras = this.items.filter((item) => !snapshot.includes(item));
			this.items = [...snapshot, ...extras];
			this.options.onQueueUpdated();
			const message = error instanceof Error ? error.message : String(error);
			this.options.onError(`Failed to process queued item${snapshot.length > 1 ? "s" : ""}: ${message}`);
		};

		try {
			if (options?.willRetry) {
				const hasCommand = this.items.some((item) => item.kind === "command");
				if (hasCommand) {
					return;
				}

				const queuedItems = [...this.items];
				this.items = [];
				this.options.onQueueUpdated();
				for (const item of queuedItems) {
					if (item.kind === "command") continue;
					await this.options.queueUserInput(item.text, item.mode);
				}
				this.options.onQueueUpdated();
				return;
			}

			while (this.items.length > 0) {
				const item = this.items[0];
				if (!item) return;

				if (item.kind === "command") {
					this.items.shift();
					this.options.onQueueUpdated();
					await this.options.executeQueuedCommand(item);
					if (this.options.isStreaming() || this.options.isCompacting()) {
						return;
					}
					continue;
				}

				const nextCommandIndex = this.items.findIndex((entry, index) => index > 0 && entry.kind === "command");
				const blockEnd = nextCommandIndex === -1 ? this.items.length : nextCommandIndex;
				const messageBlock = this.items.splice(0, blockEnd);
				this.options.onQueueUpdated();

				const [firstMessage, ...restMessages] = messageBlock;
				if (!firstMessage) return;

				const promptPromise = this.options.prompt(firstMessage.text).catch((error) => {
					restoreQueue(error);
				});

				if (restMessages.length > 0) {
					for (const message of restMessages) {
						await this.options.queueUserInput(message.text, message.mode);
					}
					this.options.onQueueUpdated();
				}

				void promptPromise;
				return;
			}
		} catch (error) {
			restoreQueue(error);
		} finally {
			this.isFlushing = false;
		}
	}
}
