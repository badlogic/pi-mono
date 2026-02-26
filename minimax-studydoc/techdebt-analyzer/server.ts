/**
 * TechDebt Analyzer Server
 * 
 * 基于 pi-coding-agent SDK 构建的技术债分析服务
 * 
 * === codingTools 是什么？===
 * codingTools 是 coding-agent 提供的默认工具集，包含4个核心工具：
 * 
 * 1. readTool (读取工具)
 *    - 功能：读取文件内容
 *    - 用途：让AI能够查看代码文件、配置文件等
 *    - 示例：读取 .ts, .js, .json, .md 等文件
 * 
 * 2. bashTool (终端工具)
 *    - 功能：执行Shell命令
 *    - 用途：运行 npm install, git status, 构建命令等
 *    - 示例：执行 git log, npm run build, ls 等
 * 
 * 3. editTool (编辑工具)
 *    - 功能：修改文件内容
 *    - 用途：直接修改代码文件
 *    - 示例：添加/删除/替换代码行
 * 
 * 4. writeTool (写入工具)
 *    - 功能：创建或覆盖文件
 *    - 用途：生成新文件或重写现有文件
 *    - 示例：创建新组件、写入配置文件
 * 
 * === 为什么使用 codingTools？===
 * - 对于技术债分析，主要需要 readTool 和 bashTool 来"读取"代码
 * - editTool 和 writeTool 是可选的（分析过程不需要修改代码）
 * - 如果只需要只读分析，可以用 readOnlyTools = [readTool, grepTool, findTool, lsTool]
 * 
 * === 其他可用工具集 ===
 * - readOnlyTools: [readTool, grepTool, findTool, lsTool] - 只读分析
 * - allTools: [read, bash, edit, write, grep, find, ls] - 全部工具
 * 
 * ========================================================================
 * Thinking Level (推理强度):
 * - "off": 关闭推理
 * - "low": 低推理
 * - "medium": 中等推理 (默认)
 * - "high": 高推理
 * - "xhigh": 极高推理 (仅GPT-5.2/5.3和Claude Opus 4.6支持)
 */

import express from "express";
import { createAgentSession, codingTools } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { Transport } from "@mariozechner/pi-ai";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "@mariozechner/pi-coding-agent";

const app = express();
app.use(express.json());

const STUDY_DOC_DIR = join(process.cwd(), "study-doc");
const TECHDEBT_DOC_PATH = join(process.cwd(), "techdebt.md");

const SYSTEM_PROMPT = `你是一个专业的代码审查专家和架构师。你的任务是研究当前代码仓库，参考技术债列表文档，然后详细列出当前代码库中的技术债。

## 分析要求
1. 首先读取 techdebt.md 文件了解已有的技术债列表
2. 全面扫描代码库，识别新的技术债
3. 对每项技术债，说明：
   - 问题描述
   - 所在文件/模块
   - 严重程度（高/中/低）
   - 建议解决方案

## 输出格式
请用中文markdown格式输出，保存到 study-doc/techdebt-analysis.md

格式如下：
# 技术债分析报告

## 一、已识别技术债（来自techdebt.md）
[列出techdebt.md中的现有技术债]

## 二、新发现技术债
### 1. [问题名称]
- **严重程度**: 高/中/低
- **位置**: 文件路径
- **问题描述**: 
- **建议**: 

...

## 三、总结
[总体评估]
`;

if (!existsSync(STUDY_DOC_DIR)) {
	mkdirSync(STUDY_DOC_DIR, { recursive: true });
}

function getTechdebtDoc(): string {
	if (existsSync(TECHDEBT_DOC_PATH)) {
		return readFileSync(TECHDEBT_DOC_PATH, "utf-8");
	}
	return "# 技术债文档\n\n（暂无techdebt.md文件）\n";
}

/**
 * 获取模型配置的辅助函数
 * 
 * 支持的模型选择方式:
 * 1. 指定 provider + modelId
 * 2. 使用预设配置
 * 
 * 常用模型ID:
 * - anthropic: claude-sonnet-4-20250514, claude-opus-4-5-20250514
 * - azure-openai-responses: gpt-4, gpt-4o, gpt-4.1, codex-mini-latest
 * - openai: gpt-5.1, gpt-5.2, gpt-5.3, gpt-5.1-codex-mini
 */
function getConfiguredModel(params: {
	provider?: string;
	modelId?: string;
}): ReturnType<typeof getModel> {
	const { provider, modelId } = params;
	
	// 如果指定了provider和model，使用自定义配置
	if (provider && modelId) {
		console.log(`[配置] 使用自定义模型: ${provider}/${modelId}`);
		return getModel(provider as any, modelId as any);
	}
	
	// 默认使用 Anthropic Claude
	console.log(`[配置] 使用默认模型: anthropic/claude-sonnet-4-20250514`);
	return getModel("anthropic", "claude-sonnet-4-20250514");
}

app.post("/analyze", async (req, res) => {
	try {
		/**
		 * 请求体参数说明:
		 * {
		 *   provider: "azure-openai-responses" | "anthropic" | "openai",  // 可选，默认 anthropic
		 *   model: "gpt-4" | "claude-sonnet-4-20250514" | "gpt-5.1",   // 模型ID
		 *   thinkingLevel: "off" | "low" | "medium" | "high" | "xhigh",  // 可选，默认 medium
		 *   transport: "sse" | "websocket" | "auto"                        // 可选，默认 sse (网络慢时用websocket)
		 * }
		 */
		const { 
			provider, 
			model: modelId, 
			thinkingLevel = "medium",
			transport = "sse"  // 默认SSE，网络慢时可改为 "websocket"
		} = req.body;

		// 获取模型配置
		const model = getConfiguredModel({ provider, modelId });
		
		console.log(`[TechDebt Analyzer] 使用模型: ${model.provider}/${model.id}`);
		console.log(`[TechDebt Analyzer] Transport: ${transport}`);
		console.log(`[TechDebt Analyzer] Thinking Level: ${thinkingLevel}`);

		const techdebtContent = getTechdebtDoc();
		
		const combinedPrompt = `${SYSTEM_PROMPT}

## 现有techdebt.md内容：
${techdebtContent}

请开始分析代码仓库，识别技术债。`;

		/**
		 * 创建 AgentSession 的配置选项
		 * 
		 * 关键配置:
		 * - model: 使用的模型 (通过 getModel 获取)
		 * - thinkingLevel: 推理强度
		 * - tools: 工具集 (codingTools 提供读、写、编辑、执行命令能力)
		 * - cwd: 工作目录 (process.cwd() 即当前项目根目录)
		 * - settingsManager: 用于传递 transport 等设置
		 * 
		 * 注意: createAgentSession 内部会从环境变量或 settings 读取 API key
		 * Azure 需要设置: AZURE_OPENAI_API_KEY
		 */
		
		// 创建自定义 SettingsManager，用于配置 transport 等参数
		const settingsManager = SettingsManager.create(process.cwd(), join(process.cwd(), ".pi/agent"));
		
		// 设置 transport (网络慢时使用 websocket 更稳定)
		// 可选值: "sse" (默认), "websocket", "auto"
		settingsManager.setTransport(transport as any);
		
		const { session } = await createAgentSession({
			model,
			thinkingLevel: thinkingLevel as any,
			tools: codingTools,
			cwd: process.cwd(),
			settingsManager,  // 传入自定义的 settingsManager 以应用 transport 设置
		});

		let result = "";
		
		// 订阅会话事件，收集AI的响应
		// 
		// 事件类型说明:
		// - message_update: AI正在输出消息时触发 (流式)
		// - message_end: AI完成一条消息时触发
		// - tool_execution_start: 开始执行工具时触发
		// - tool_execution_end: 工具执行完成时触发
		session.subscribe((event) => {
			if (event.type === "message_update" && event.message.role === "assistant") {
				const content = event.message.content;
				if (Array.isArray(content)) {
					for (const c of content) {
						if (c.type === "text") {
							result += c.text;
						}
					}
				}
			}
			if (event.type === "tool_execution_start") {
				console.log(`[Tool] ${event.toolName}: ${JSON.stringify(event.args).slice(0, 100)}`);
			}
			if (event.type === "tool_execution_end") {
				if (event.isError) {
					console.log(`[Tool Error] ${event.toolName}: ${event.result}`);
				}
			}
		});

		// 发送分析请求
		// 这里会使用已配置的模型和工具来分析代码仓库
		await session.prompt(combinedPrompt);

		// 将分析结果写入文件
		const outputPath = join(STUDY_DOC_DIR, "techdebt-analysis.md");
		writeFileSync(outputPath, result, "utf-8");

		console.log(`[TechDebt Analyzer] 分析完成，结果已保存到: ${outputPath}`);

		res.json({
			success: true,
			outputPath,
			result: result.slice(0, 1000) + (result.length > 1000 ? "..." : ""),
		});
	} catch (error) {
		console.error("[TechDebt Analyzer] 错误:", error);
		res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
});

app.get("/health", (req, res) => {
	res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log(`
╔═══════════════════════════════════════════╗
║     TechDebt Analyzer Server              ║
║     技术债分析服务                         ║
╠═══════════════════════════════════════════╣
║  健康检查: http://localhost:${PORT}/health    ║
║  分析接口: POST http://localhost:${PORT}/analyze ║
║                                           ║
║  请求体示例:                              ║
║  {                                       ║
║    "provider": "azure-openai-responses", ║
║    "model": "gpt-4",                    ║
║    "thinkingLevel": "medium",           ║
║    "transport": "websocket"              ║
║  }                                       ║
║                                           ║
║  输出目录: ${STUDY_DOC_DIR}     ║
╚═══════════════════════════════════════════╝
	`);
});
