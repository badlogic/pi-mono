export type TransportName = "slack" | "discord";

export type ReplyTarget = "primary" | "secondary";

export interface ChannelInfo {
	id: string;
	name: string;
}

export interface UserInfo {
	id: string;
	userName: string;
	displayName: string;
}

export interface TransportFormatting {
	italic(text: string): string;
	bold(text: string): string;
	code(text: string): string;
	codeBlock(text: string): string;
}

export interface ToolResultData {
	toolName: string;
	label?: string;
	args?: string;
	result: string;
	isError: boolean;
	durationSecs: string;
}

export interface TransportContext {
	transport: TransportName;

	// Host filesystem layout (absolute paths)
	workingDir: string;
	channelDir: string;

	// Optional display metadata
	channelName?: string;
	guildId?: string;
	guildName?: string;

	// The triggering message
	message: {
		text: string;
		rawText: string;
		userId: string;
		userName?: string;
		displayName?: string;
		channelId: string;
		messageId: string; // Slack: ts, Discord: snowflake
		attachments: Array<{ local: string }>;
	};

	// Used for system prompt channel/user mapping
	channels: ChannelInfo[];
	users: UserInfo[];

	// Formatting + splitting owned by transport
	formatting: TransportFormatting;
	limits: {
		primaryMaxChars: number;
		secondaryMaxChars: number;
	};

	// Messaging API
	send(target: ReplyTarget, text: string, opts?: { log?: boolean }): Promise<void>;
	replacePrimary(text: string): Promise<void>;

	setTyping(isTyping: boolean): Promise<void>;
	setWorking(working: boolean): Promise<void>;
	deletePrimaryAndSecondary(): Promise<void>;

	uploadFile(filePath: string, title?: string): Promise<void>;

	// Optional transport-specific UX
	sendToolResult?: (data: ToolResultData) => Promise<void>;
	addStopControl?: () => Promise<void>;
	removeStopControl?: () => Promise<void>;
}
