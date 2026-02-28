import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { glob } from "glob";
import { join, resolve } from "path";
import { execSync } from "child_process";
import type { ExecutionContract, Snapshot } from "./types.js";

export interface SnapshotBuilderOptions {
  workingDir: string;
  includeGitHash?: boolean;
}

export class SnapshotBuilder {
  private workingDir: string;
  private includeGitHash: boolean;

  constructor(options: SnapshotBuilderOptions) {
    this.workingDir = resolve(options.workingDir);
    this.includeGitHash = options.includeGitHash ?? true;
  }

  async build(
    userPrompt: string,
    skillText: string,
    contract: ExecutionContract,
  ): Promise<Snapshot> {
    // Calculate file digests for required files
    const fileDigests = await this.calculateFileDigests(contract.requiredFiles);

    // Get git commit hash if available
    const repoCommitHash = this.includeGitHash
      ? this.getGitCommitHash()
      : undefined;

    // Define tool whitelist - only non-interactive tools
    const toolWhitelist = this.buildToolWhitelist(contract.requiredTools);

    return {
      prompt: userPrompt,
      skillText,
      contract,
      fileDigests,
      toolWhitelist,
      repoCommitHash,
      createdAt: Date.now(),
    };
  }

  private async calculateFileDigests(
    filePatterns: string[],
  ): Promise<Record<string, string>> {
    const digests: Record<string, string> = {};

    for (const pattern of filePatterns) {
      try {
        // Handle glob patterns
        const files = await glob(pattern, {
          cwd: this.workingDir,
          absolute: true,
          nodir: true,
        });

        for (const file of files) {
          if (existsSync(file) && statSync(file).isFile()) {
            const content = readFileSync(file);
            const hash = createHash("sha256").update(content).digest("hex");
            // Store relative path
            const relativePath = file.replace(this.workingDir, "").replace(/^[/\\]/, "");
            digests[relativePath] = hash;
          }
        }
      } catch (error) {
        // If pattern doesn't match any files, log but don't fail
        console.warn(`Pattern '${pattern}' did not match any files`);
      }
    }

    return digests;
  }

  private getGitCommitHash(): string | undefined {
    try {
      const hash = execSync("git rev-parse HEAD", {
        cwd: this.workingDir,
        encoding: "utf-8",
      }).trim();
      return hash;
    } catch {
      // Not a git repo or git not available
      return undefined;
    }
  }

  private buildToolWhitelist(requiredTools: string[]): string[] {
    // Base tools that are always safe (non-interactive)
    const baseTools = [
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
    ];

    // Filter out interactive tools
    const interactiveTools = ["ask_user", "question", "clarify", "confirm"];

    const whitelist = new Set(baseTools);

    for (const tool of requiredTools) {
      if (!interactiveTools.includes(tool.toLowerCase())) {
        whitelist.add(tool.toLowerCase());
      }
    }

    return Array.from(whitelist);
  }

  verifyFiles(snapshot: Snapshot): { valid: boolean; changed: string[] } {
    const changed: string[] = [];

    for (const [relativePath, expectedHash] of Object.entries(
      snapshot.fileDigests,
    )) {
      const fullPath = join(this.workingDir, relativePath);

      if (!existsSync(fullPath)) {
        changed.push(`${relativePath} (deleted)`);
        continue;
      }

      const content = readFileSync(fullPath);
      const currentHash = createHash("sha256").update(content).digest("hex");

      if (currentHash !== expectedHash) {
        changed.push(relativePath);
      }
    }

    return {
      valid: changed.length === 0,
      changed,
    };
  }

  formatSnapshot(snapshot: Snapshot): string {
    const lines = [
      "=== Execution Snapshot ===",
      `Created: ${new Date(snapshot.createdAt).toISOString()}`,
      `Repo Commit: ${snapshot.repoCommitHash ?? "N/A"}`,
      "",
      "Files Frozen:",
      ...Object.keys(snapshot.fileDigests).map((f) => `  - ${f}`),
      "",
      "Tool Whitelist:",
      ...snapshot.toolWhitelist.map((t) => `  - ${t}`),
      "",
      "Contract:",
      `  Inputs: ${snapshot.contract.requiredInputs.join(", ") || "None"}`,
      `  Tools: ${snapshot.contract.requiredTools.join(", ") || "None"}`,
      "==========================",
    ];

    return lines.join("\n");
  }
}
