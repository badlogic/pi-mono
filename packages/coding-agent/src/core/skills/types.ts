export interface SkillFrontmatter {
	name?: string;
	description: string;
}

export type SkillSource = "user" | "project" | "claude-user" | "claude-project";

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	source: SkillSource;
}
