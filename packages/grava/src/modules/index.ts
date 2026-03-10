/**
 * Pluggable Sub-Modules — 未来子模块
 *
 * Each sub-module is an independent, pluggable package that mounts onto the Agent Runtime.
 * Each module = Extension + Skills + Tools package.
 *
 * Planned modules:
 * - Commodity Analytics: 期货/大宗商品 (行情监控, 信号, 风险)
 * - Research Agent: 深度研究自动化 (论文检索, 摘要, 知识图谱)
 * - Code Agent: 编码辅助 (LSP, Git, Review)
 */

import type { Skill } from "../runtime/index.js";

export interface GravaModule {
	/** Unique module identifier */
	id: string;
	/** Display name */
	name: string;
	/** Module description */
	description: string;
	/** Skills provided by this module */
	skills: Skill[];
	/** Initialize the module */
	initialize(): Promise<void>;
	/** Shutdown the module */
	shutdown(): Promise<void>;
}

export class ModuleRegistry {
	private modules = new Map<string, GravaModule>();

	async register(module: GravaModule): Promise<void> {
		await module.initialize();
		this.modules.set(module.id, module);
	}

	get(id: string): GravaModule | undefined {
		return this.modules.get(id);
	}

	all(): GravaModule[] {
		return Array.from(this.modules.values());
	}

	/** Get all skills from all registered modules */
	allSkills(): Skill[] {
		return this.all().flatMap((m) => m.skills);
	}

	async shutdown(): Promise<void> {
		await Promise.all(this.all().map((m) => m.shutdown()));
	}
}
