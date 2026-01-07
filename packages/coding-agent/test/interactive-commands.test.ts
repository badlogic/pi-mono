import { beforeEach, describe, expect, it } from "vitest";
import {
	configureInteractiveCommands,
	DEFAULT_INTERACTIVE_COMMANDS,
	getInteractiveCommands,
	isInteractiveCommand,
} from "../src/utils/interactive-commands.js";

describe("isInteractiveCommand", () => {
	beforeEach(() => {
		// Reset to defaults before each test
		configureInteractiveCommands({ additional: [], excluded: [] });
	});

	describe("editors", () => {
		it("detects vim", () => {
			expect(isInteractiveCommand("vim file.txt")).toBe(true);
			expect(isInteractiveCommand("vim")).toBe(true);
			expect(isInteractiveCommand("nvim file.txt")).toBe(true);
			expect(isInteractiveCommand("vi file.txt")).toBe(true);
		});

		it("detects nano", () => {
			expect(isInteractiveCommand("nano file.txt")).toBe(true);
		});

		it("detects emacs", () => {
			expect(isInteractiveCommand("emacs file.txt")).toBe(true);
		});

		it("detects helix", () => {
			expect(isInteractiveCommand("helix file.txt")).toBe(true);
			expect(isInteractiveCommand("hx file.txt")).toBe(true);
		});

		it("detects editors in pipes", () => {
			expect(isInteractiveCommand("cat file.txt | vim -")).toBe(true);
		});
	});

	describe("pagers", () => {
		it("detects less", () => {
			expect(isInteractiveCommand("less file.txt")).toBe(true);
		});

		it("detects more", () => {
			expect(isInteractiveCommand("more file.txt")).toBe(true);
		});

		it("detects piped pagers", () => {
			expect(isInteractiveCommand("cat file.txt | less")).toBe(true);
			expect(isInteractiveCommand("git log | less")).toBe(true);
		});
	});

	describe("git interactive", () => {
		it("detects git rebase (can have conflicts)", () => {
			expect(isInteractiveCommand("git rebase main")).toBe(true);
			expect(isInteractiveCommand("git rebase -i HEAD~3")).toBe(true);
			expect(isInteractiveCommand("git rebase --interactive HEAD~3")).toBe(true);
		});

		it("detects git merge (can have conflicts)", () => {
			expect(isInteractiveCommand("git merge feature")).toBe(true);
		});

		it("detects git cherry-pick (can have conflicts)", () => {
			expect(isInteractiveCommand("git cherry-pick abc123")).toBe(true);
		});

		it("detects git commit", () => {
			expect(isInteractiveCommand("git commit")).toBe(true);
			expect(isInteractiveCommand("git commit --amend")).toBe(true);
			expect(isInteractiveCommand("git commit -m 'message'")).toBe(true); // still interactive (editor may open)
		});

		it("detects git add -p", () => {
			expect(isInteractiveCommand("git add -p")).toBe(true);
			expect(isInteractiveCommand("git add --patch")).toBe(true);
			expect(isInteractiveCommand("git add -p file.txt")).toBe(true);
		});

		it("detects git difftool and mergetool", () => {
			expect(isInteractiveCommand("git difftool")).toBe(true);
			expect(isInteractiveCommand("git mergetool")).toBe(true);
		});
	});

	describe("TUI tools", () => {
		it("detects htop/top/btop", () => {
			expect(isInteractiveCommand("htop")).toBe(true);
			expect(isInteractiveCommand("top")).toBe(true);
			expect(isInteractiveCommand("btop")).toBe(true);
		});

		it("detects ncdu", () => {
			expect(isInteractiveCommand("ncdu")).toBe(true);
		});

		it("detects file managers", () => {
			expect(isInteractiveCommand("ranger")).toBe(true);
			expect(isInteractiveCommand("nnn")).toBe(true);
			expect(isInteractiveCommand("mc")).toBe(true);
		});

		it("detects git TUIs", () => {
			expect(isInteractiveCommand("tig")).toBe(true);
			expect(isInteractiveCommand("lazygit")).toBe(true);
			expect(isInteractiveCommand("gitui")).toBe(true);
		});

		it("detects fzf", () => {
			expect(isInteractiveCommand("fzf")).toBe(true);
		});
	});

	describe("remote sessions", () => {
		it("detects ssh", () => {
			expect(isInteractiveCommand("ssh user@host")).toBe(true);
		});

		it("detects telnet", () => {
			expect(isInteractiveCommand("telnet host")).toBe(true);
		});

		it("detects mosh", () => {
			expect(isInteractiveCommand("mosh user@host")).toBe(true);
		});
	});

	describe("database clients", () => {
		it("detects psql", () => {
			expect(isInteractiveCommand("psql")).toBe(true);
			expect(isInteractiveCommand("psql -U user db")).toBe(true);
		});

		it("detects mysql", () => {
			expect(isInteractiveCommand("mysql")).toBe(true);
			expect(isInteractiveCommand("mysql -u root db")).toBe(true);
		});

		it("detects sqlite3", () => {
			expect(isInteractiveCommand("sqlite3 db.sqlite")).toBe(true);
		});
	});

	describe("docker/kubernetes", () => {
		it("detects kubectl edit", () => {
			expect(isInteractiveCommand("kubectl edit deployment/app")).toBe(true);
		});

		it("detects kubectl exec -it", () => {
			expect(isInteractiveCommand("kubectl exec -it pod -- /bin/bash")).toBe(true);
		});

		it("detects docker exec -it", () => {
			expect(isInteractiveCommand("docker exec -it container bash")).toBe(true);
		});

		it("detects docker run -it", () => {
			expect(isInteractiveCommand("docker run -it ubuntu bash")).toBe(true);
		});
	});

	describe("non-interactive commands", () => {
		it("returns false for regular commands", () => {
			expect(isInteractiveCommand("ls -la")).toBe(false);
			expect(isInteractiveCommand("cat file.txt")).toBe(false);
			expect(isInteractiveCommand("grep pattern file")).toBe(false);
			expect(isInteractiveCommand("echo hello")).toBe(false);
			expect(isInteractiveCommand("curl https://example.com")).toBe(false);
			expect(isInteractiveCommand("npm install")).toBe(false);
		});

		it("returns false for git non-interactive commands", () => {
			expect(isInteractiveCommand("git status")).toBe(false);
			expect(isInteractiveCommand("git log --oneline")).toBe(false);
			expect(isInteractiveCommand("git diff")).toBe(false);
			expect(isInteractiveCommand("git push")).toBe(false);
			expect(isInteractiveCommand("git pull")).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("handles whitespace", () => {
			expect(isInteractiveCommand("  vim file.txt  ")).toBe(true);
			expect(isInteractiveCommand("\tvim file.txt")).toBe(true);
		});

		it("handles git stash variations", () => {
			expect(isInteractiveCommand("git stash -p")).toBe(true);
			expect(isInteractiveCommand("git stash push -p")).toBe(true);
			expect(isInteractiveCommand("git stash --patch")).toBe(true);
		});

		it("is case insensitive", () => {
			expect(isInteractiveCommand("VIM file.txt")).toBe(true);
			expect(isInteractiveCommand("Git Commit")).toBe(true);
		});
	});

	describe("configuration", () => {
		it("can add custom commands", () => {
			expect(isInteractiveCommand("mycustomtool")).toBe(false);

			configureInteractiveCommands({ additional: ["mycustomtool"] });

			expect(isInteractiveCommand("mycustomtool")).toBe(true);
			expect(isInteractiveCommand("mycustomtool --flag")).toBe(true);
		});

		it("can exclude default commands", () => {
			expect(isInteractiveCommand("vim")).toBe(true);

			configureInteractiveCommands({ excluded: ["vim"] });

			expect(isInteractiveCommand("vim")).toBe(false);
			expect(isInteractiveCommand("nvim")).toBe(true); // other editors still work
		});

		it("getInteractiveCommands returns merged list", () => {
			configureInteractiveCommands({
				additional: ["myeditor"],
				excluded: ["vim"],
			});

			const commands = getInteractiveCommands();
			expect(commands).toContain("myeditor");
			expect(commands).not.toContain("vim");
			expect(commands).toContain("nvim");
		});

		it("DEFAULT_INTERACTIVE_COMMANDS is exported", () => {
			expect(DEFAULT_INTERACTIVE_COMMANDS).toContain("vim");
			expect(DEFAULT_INTERACTIVE_COMMANDS).toContain("git commit");
			expect(DEFAULT_INTERACTIVE_COMMANDS).toContain("htop");
		});
	});
});
