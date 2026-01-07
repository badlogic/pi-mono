/**
 * Detection and handling of interactive shell commands.
 *
 * Interactive commands are those that need full terminal access to work correctly,
 * such as editors (vim, nano), pagers (less, more), and interactive git operations
 * (git rebase -i, git commit without -m, etc.).
 */

/**
 * Default list of interactive commands.
 * These commands will be run with full terminal access (stdio: "inherit").
 *
 * Format:
 * - Simple command name: "vim" matches "vim", "vim file.txt", etc.
 * - Command with subcommand: "git commit" matches "git commit", "git commit --amend", etc.
 * - Prefix match: command is matched at the start or after a pipe
 */
export const DEFAULT_INTERACTIVE_COMMANDS: string[] = [
	// Editors
	"vim",
	"nvim",
	"vi",
	"nano",
	"emacs",
	"pico",
	"joe",
	"micro",
	"helix",
	"hx",
	"kak", // kakoune

	// Pagers
	"less",
	"more",
	"most",

	// Git interactive commands
	"git commit",
	"git rebase",
	"git merge",
	"git cherry-pick",
	"git revert",
	"git am",
	"git add -p",
	"git add --patch",
	"git add -i",
	"git add --interactive",
	"git stash -p",
	"git stash --patch",
	"git stash push -p",
	"git stash push --patch",
	"git reset -p",
	"git reset --patch",
	"git checkout -p",
	"git checkout --patch",
	"git difftool",
	"git mergetool",
	"git send-email",

	// System monitors
	"htop",
	"top",
	"btop",
	"glances",
	"nmon",

	// Disk usage
	"ncdu",

	// File managers
	"ranger",
	"nnn",
	"lf",
	"mc",
	"vifm",

	// Git TUIs
	"tig",
	"lazygit",
	"gitui",

	// Fuzzy finders
	"fzf",
	"sk",

	// Remote sessions
	"ssh",
	"telnet",
	"mosh",

	// Database clients (interactive mode)
	"psql",
	"mysql",
	"sqlite3",
	"mongosh",
	"redis-cli",

	// Kubernetes
	"kubectl edit",
	"kubectl exec -it",
	"kubectl exec --stdin --tty",

	// Docker
	"docker exec -it",
	"docker run -it",
	"docker attach",

	// Other TUIs
	"tmux",
	"screen",
	"weechat",
	"irssi",
	"mutt",
	"neomutt",
	"aerc",
];

// Configuration state
let additionalCommands: string[] = [];
let excludedCommands: string[] = [];

/**
 * Configure interactive command detection.
 * Call this at startup with settings from SettingsManager.
 */
export function configureInteractiveCommands(config: { additional?: string[]; excluded?: string[] }): void {
	additionalCommands = config.additional ?? [];
	excludedCommands = config.excluded ?? [];
}

/**
 * Get all active interactive commands (default + additional - excluded).
 */
export function getInteractiveCommands(): string[] {
	const excludeSet = new Set(excludedCommands.map((c) => c.toLowerCase()));
	const commands = [...DEFAULT_INTERACTIVE_COMMANDS, ...additionalCommands];
	return commands.filter((cmd) => !excludeSet.has(cmd.toLowerCase()));
}

/**
 * Check if a command needs interactive terminal access.
 *
 * @param command - The shell command to check
 * @returns true if the command should be run interactively
 */
export function isInteractiveCommand(command: string): boolean {
	const trimmed = command.trim().toLowerCase();
	const commands = getInteractiveCommands();

	for (const interactiveCmd of commands) {
		const cmdLower = interactiveCmd.toLowerCase();

		// Check if command starts with the interactive command
		if (trimmed === cmdLower || trimmed.startsWith(`${cmdLower} `) || trimmed.startsWith(`${cmdLower}\t`)) {
			return true;
		}

		// Check after pipe: "cat file | less"
		const pipeIndex = trimmed.lastIndexOf("|");
		if (pipeIndex !== -1) {
			const afterPipe = trimmed.slice(pipeIndex + 1).trim();
			if (afterPipe === cmdLower || afterPipe.startsWith(`${cmdLower} `) || afterPipe.startsWith(`${cmdLower}\t`)) {
				return true;
			}
		}
	}

	return false;
}
