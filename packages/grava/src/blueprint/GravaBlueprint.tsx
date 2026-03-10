import { useState } from "react";

const C = {
	bg: "#0b0b12",
	card: "#101018",
	cardAlt: "#131320",
	border: "#1f1f35",
	text: "#eaeaf4",
	sub: "#a0a0bc",
	dim: "#686888",
	gold: "#d4a853",
	goldSoft: "rgba(212,168,83,0.07)",
	client: "#34d399",
	gateway: "#818cf8",
	search: "#fb923c",
	runtime: "#f472b6",
	audit: "#fb7185",
	memory: "#a78bfa",
	cognition: "#e879f9",
	llm: "#4ade80",
	future: "#fbbf24",
};

/* ─── Primitives ─── */

function Card({
	color,
	title,
	badge,
	sub: subtitle,
	children,
	style,
}: {
	color: string;
	title?: string;
	badge?: string;
	sub?: string;
	children?: React.ReactNode;
	style?: React.CSSProperties;
}) {
	return (
		<div
			style={{
				background: C.card,
				border: `1px solid ${color}22`,
				borderRadius: 10,
				padding: "16px 18px",
				...style,
			}}
		>
			{title && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: subtitle ? 3 : 10,
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<div
							style={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								background: color,
								boxShadow: `0 0 10px ${color}50`,
							}}
						/>
						<span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{title}</span>
					</div>
					{badge && (
						<span
							style={{
								fontSize: 9,
								fontWeight: 700,
								color,
								background: `${color}18`,
								padding: "3px 10px",
								borderRadius: 20,
								letterSpacing: "0.03em",
							}}
						>
							{badge}
						</span>
					)}
				</div>
			)}
			{subtitle && (
				<p style={{ fontSize: 10, color: C.dim, margin: "0 0 12px 16px", lineHeight: 1.4 }}>{subtitle}</p>
			)}
			{children}
		</div>
	);
}

function Mod({
	name,
	color,
	desc,
	tags,
	style,
}: {
	name: string;
	color: string;
	desc?: string;
	tags?: string[];
	style?: React.CSSProperties;
}) {
	return (
		<div
			style={{
				background: `${color}0a`,
				border: `1px solid ${color}1a`,
				borderRadius: 7,
				padding: "10px 12px",
				...style,
			}}
		>
			<div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: desc ? 2 : 4 }}>{name}</div>
			{desc && <div style={{ fontSize: 9, color: C.dim, marginBottom: 5, lineHeight: 1.4 }}>{desc}</div>}
			{tags && (
				<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
					{tags.map((t, i) => (
						<span
							key={i}
							style={{
								fontSize: 8.5,
								color: C.sub,
								background: "rgba(255,255,255,0.04)",
								padding: "2px 8px",
								borderRadius: 4,
							}}
						>
							{t}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

function Arrow({ label, color }: { label?: string; color?: string }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 0" }}>
			{label && (
				<span style={{ fontSize: 8, color: C.dim, letterSpacing: "0.06em", marginBottom: 2 }}>{label}</span>
			)}
			<div style={{ width: 1, height: 14, background: `${color || C.dim}50` }} />
			<span style={{ fontSize: 9, color: `${color || C.dim}70` }}>▾</span>
		</div>
	);
}

function Divider({ label, color }: { label?: string; color?: string }) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }}>
			<div style={{ flex: 1, height: 1, background: `${color || C.border}` }} />
			{label && (
				<span
					style={{
						fontSize: 8,
						fontWeight: 700,
						color: color || C.dim,
						letterSpacing: "0.1em",
						whiteSpace: "nowrap",
					}}
				>
					{label}
				</span>
			)}
			<div style={{ flex: 1, height: 1, background: `${color || C.border}` }} />
		</div>
	);
}

function Grid({
	cols,
	gap = 8,
	children,
	style,
}: {
	cols: string;
	gap?: number;
	children?: React.ReactNode;
	style?: React.CSSProperties;
}) {
	return <div style={{ display: "grid", gridTemplateColumns: cols, gap, ...style }}>{children}</div>;
}

/* ─── Main ─── */

export default function GravaBlueprintV3() {
	return (
		<div
			style={{
				background: C.bg,
				color: C.text,
				minHeight: "100vh",
				fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
				padding: "32px 20px",
				maxWidth: 760,
				margin: "0 auto",
			}}
		>
			{/* Header */}
			<div style={{ marginBottom: 28 }}>
				<div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
					<h1 style={{ fontSize: 24, fontWeight: 900, color: C.gold, margin: 0, letterSpacing: "0.12em" }}>
						GRAVA
					</h1>
					<span style={{ fontSize: 11, color: C.dim, fontWeight: 700, letterSpacing: "0.08em" }}>
						BLUEPRINT v0.3
					</span>
				</div>
				<p style={{ fontSize: 10, color: C.dim, margin: "8px 0 0", lineHeight: 1.6 }}>
					基于 Pi Mono · 借鉴 OpenClaw · AI Search 前置滤网 · 多方审计 · 四层记忆体系（含认知记忆）· 子模块可插拔
				</p>
				<p style={{ fontSize: 10, color: C.gold, margin: "4px 0 0", fontStyle: "italic", opacity: 0.6 }}>
					"Grava doesn't make AI smarter. It makes human intent more complete."
				</p>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				{/* ═══════ 1: CLIENT ═══════ */}
				<Card
					color={C.client}
					title="外部接入层 · Client"
					badge="自建 UI + 50+ Channel"
					sub="自建 iOS/Mac 客户端为主入口，保留 channel adapter 架构日后拓展"
				>
					<Grid cols="1fr 1fr">
						<div>
							<div style={{ fontSize: 10, fontWeight: 700, color: C.client, marginBottom: 8 }}>
								主入口 · 你自己写
							</div>
							<Grid cols="1fr 1fr" gap={6}>
								<Mod name="iOS Client" color={C.client} tags={["SwiftUI", "Push", "离线"]} />
								<Mod name="macOS Client" color={C.client} tags={["Native", "Menubar", "快捷键"]} />
							</Grid>
							<div
								style={{
									marginTop: 8,
									padding: "8px 10px",
									borderRadius: 6,
									background: `${C.client}08`,
									border: `1px dashed ${C.client}18`,
								}}
							>
								<div style={{ fontSize: 10, fontWeight: 700, color: C.client, marginBottom: 3 }}>
									Session 可查阅性
								</div>
								<div style={{ fontSize: 9, color: C.dim, lineHeight: 1.5 }}>
									完整对话历史回溯 · 搜索/过滤 · 审计记录可视化 · 决策链路追踪 · 认知演化时间线
								</div>
							</div>
						</div>
						<div>
							<div style={{ fontSize: 10, fontWeight: 700, color: C.sub, marginBottom: 8 }}>
								Channel Adapters · 日后拓展
							</div>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
								{[
									"WeChat",
									"Telegram",
									"Slack",
									"Discord",
									"WhatsApp",
									"Signal",
									"iMessage",
									"Teams",
									"飞书",
									"LINE",
									"+40 more",
								].map((ch) => (
									<span
										key={ch}
										style={{
											fontSize: 8,
											color: C.dim,
											background: "rgba(255,255,255,0.03)",
											padding: "2px 7px",
											borderRadius: 4,
										}}
									>
										{ch}
									</span>
								))}
							</div>
							<div style={{ marginTop: 8, fontSize: 9, color: C.dim, lineHeight: 1.4 }}>
								保留 OpenClaw 架构 · 统一消息归一化 · 随时接入新平台
							</div>
						</div>
					</Grid>
				</Card>

				<Arrow label="消息归一化 → dispatch" color={C.client} />

				{/* ═══════ 2: GATEWAY ═══════ */}
				<Card
					color={C.gateway}
					title="Gateway · 入口整合"
					badge="路由 + 认证 + 文件"
					sub="统一入口 · 不做推理 · 只路由和排队"
				>
					<Grid cols="1fr 1fr 1fr 1fr" gap={6}>
						<Mod name="Auth" color={C.gateway} tags={["Token", "Device pair", "Allowlist"]} />
						<Mod
							name="Session Router"
							color={C.gateway}
							tags={["创建/恢复", "Agent 分派", "Lane Queue"]}
						/>
						<Mod name="File Endpoint" color={C.gateway} tags={["Upload", "Download", "Media"]} />
						<Mod name="Event Bus" color={C.gateway} tags={["SSE stream", "Heartbeat", "状态广播"]} />
					</Grid>
				</Card>

				<Arrow label="user input" color={C.gateway} />

				{/* ═══════ 3: AI SEARCH ═══════ */}
				<Card
					color={C.search}
					title="AI Search 前置滤网"
					badge="护城河 ① · Input 端"
					sub="先搜索、再推理 · 让 LLM 基于事实而非幻觉回答"
				>
					<Grid cols="3fr 2fr">
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<Mod
								name="Search Router"
								color={C.search}
								desc="判断是否需要搜索 · 路由到合适的搜索源"
								tags={["意图分类", "关键词提取", "搜索/不搜索决策", "多源并发"]}
							/>
							<Mod
								name="Fact Injection"
								color={C.search}
								desc="搜索结果 → 结构化 context → 注入 prompt"
								tags={["相关性排序", "去重", "来源标注", "token 预算", "freshness 优先"]}
							/>
						</div>
						<div
							style={{
								background: `${C.search}0a`,
								border: `1px solid ${C.search}18`,
								borderRadius: 7,
								padding: "12px",
							}}
						>
							<div style={{ fontSize: 11, fontWeight: 700, color: C.search, marginBottom: 8 }}>
								搜索源
							</div>
							{[
								["Perplexity API", "综合搜索+摘要"],
								["Exa AI", "语义搜索"],
								["Tavily", "Agent 优化搜索"],
								["Google / Bing", "传统搜索兜底"],
								["自建索引", "私有知识库"],
							].map(([name, desc], i) => (
								<div
									key={i}
									style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}
								>
									<span style={{ fontSize: 9.5, color: C.sub }}>{name}</span>
									<span style={{ fontSize: 8.5, color: C.dim }}>{desc}</span>
								</div>
							))}
						</div>
					</Grid>
				</Card>

				<Arrow label="enriched context + facts" color={C.search} />

				{/* ═══════ 4: AGENT RUNTIME ═══════ */}
				<Card
					color={C.runtime}
					title="Agent Runtime"
					badge="pi-agent-core + SOUL.md + Heartbeat"
					sub="agentLoop 驱动 · 多 agent 人格 · 主动调度"
				>
					<Grid cols="1fr 1fr 1fr" gap={6}>
						<Mod
							name="Agent Loop"
							color={C.runtime}
							desc="from pi-agent-core"
							tags={["AgentState", "agentLoop", "Dual Queue", "Events", "Transport"]}
						/>
						<Mod
							name="Multi-Agent"
							color={C.runtime}
							desc="SOUL.md 人格系统"
							tags={["Digital Twin", "Analyst", "Coder", "路由规则", "Agent 隔离"]}
						/>
						<Mod
							name="Heartbeat"
							color={C.runtime}
							desc="定时主动执行"
							tags={["Cron", "日报", "监控", "提醒", "主动通知"]}
						/>
					</Grid>
					<Grid cols="1fr 1fr" gap={6} style={{ marginTop: 8 }}>
						<Mod
							name="Skills"
							color={C.runtime}
							desc="按需加载能力包"
							tags={["SKILL.md", "CLI+README", "渐进式 token", "Pi Packages"]}
						/>
						<Mod
							name="Tools"
							color={C.runtime}
							desc="内置 + 自定义 + Extension"
							tags={["read", "write", "edit", "bash", "registerTool()", "onToolCall hooks"]}
						/>
					</Grid>
				</Card>

				<Arrow label="raw output → 进入审计" color={C.runtime} />

				{/* ═══════ 5: AUDIT ═══════ */}
				<Card
					color={C.audit}
					title="多方审计层 · Deliberation & Audit"
					badge="护城河 ② · Output 端"
					sub="不信任单一 LLM · 多模型交叉验证 · 保障 output 真实性和完备性"
				>
					<Grid cols="1fr 1fr">
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<Mod
								name="多模型会审"
								color={C.audit}
								desc="同一 context 并发送给多个 LLM"
								tags={["Claude", "GPT", "Gemini", "DeepSeek", "可配置模型组"]}
							/>
							<Mod
								name="共识引擎"
								color={C.audit}
								desc="综合多方回答，提取共识与分歧"
								tags={["Majority vote", "Weighted scoring", "Debate protocol", "Confidence"]}
							/>
						</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<Mod
								name="事实核验"
								color={C.audit}
								desc="output 与 search 结果交叉比对"
								tags={["Claim extraction", "Source matching", "矛盾检测", "幻觉标记"]}
							/>
							<div
								style={{
									background: `${C.audit}0c`,
									border: `1px solid ${C.audit}20`,
									borderRadius: 7,
									padding: "10px 12px",
								}}
							>
								<div style={{ fontSize: 10, fontWeight: 700, color: C.audit, marginBottom: 6 }}>
									审计报告 → User
								</div>
								<div style={{ fontSize: 9.5, color: C.sub, lineHeight: 1.7 }}>
									<span style={{ color: "#4ade80" }}>✓</span> 共识结论（高置信度）
									<br />
									<span style={{ color: C.search }}>△</span> 分歧观点（附各模型来源）
									<br />
									<span style={{ color: C.audit }}>✗</span> 未验证 / 矛盾 claim
									<br />
									<span style={{ color: C.gold }}>◈</span> 决策建议（非结论）
								</div>
							</div>
						</div>
					</Grid>
					<div
						style={{
							marginTop: 8,
							padding: "8px 12px",
							borderRadius: 6,
							background: `${C.audit}08`,
							border: `1px dashed ${C.audit}15`,
							fontSize: 9.5,
							color: C.dim,
						}}
					>
						<span style={{ color: C.audit, fontWeight: 700 }}>模式切换：</span>
						Fast mode（单模型直出，日常闲聊）· Audit mode（多模型会审，重要事项）· Deep mode（审计+二轮辩论，关键决策）
					</div>
				</Card>

				<Arrow label="verified output → user / → memory" color={C.audit} />

				{/* ═══════ 6: MEMORY — THE BIG UPDATE ═══════ */}
				<Card
					color={C.memory}
					title="四层记忆体系 · Memory Architecture"
					badge="v0.3 核心更新"
					sub="从认知科学出发：工作记忆 → 情景记忆 → 语义/程序性记忆 → 认知记忆"
				>
					<Grid cols="1fr 1fr" gap={8}>
						{/* Layer 1: Working Memory */}
						<Mod
							name="① 工作记忆 · Working Memory"
							color={C.memory}
							desc="当前 session 内的对话上下文 · 相当于人脑的即时处理缓冲区"
							tags={["AgentState (pi-agent-core)", "Context window 管理", "自动 Compaction"]}
						/>
						{/* Layer 2: Episodic Memory */}
						<Mod
							name="② 情景记忆 · Episodic Memory"
							color={C.memory}
							desc="发生过什么 · Session 摘要 · 事件日志 · 时间线"
							tags={["Session 持久化", "对话摘要提取", "时间戳索引", "可按时间回溯"]}
						/>
						{/* Layer 3: Semantic + Procedural */}
						<Mod
							name="③ 语义 & 程序性记忆"
							color={C.memory}
							desc="世界知识 + 你是谁 + 怎么做事"
							tags={[
								"事实记忆 (Leo, NYU, 经济学)",
								"技能记忆 (沟通偏好, 工作流)",
								"RAG / 知识图谱",
								"Mem0 式 extract-update",
							]}
						/>
						{/* Layer 4: COGNITIVE — the new thing */}
						<div
							style={{
								background: `${C.cognition}0c`,
								border: `2px solid ${C.cognition}30`,
								borderRadius: 7,
								padding: "10px 12px",
								position: "relative",
							}}
						>
							<div
								style={{
									position: "absolute",
									top: -8,
									right: 12,
									fontSize: 8,
									fontWeight: 700,
									color: C.bg,
									background: C.cognition,
									padding: "2px 8px",
									borderRadius: 10,
								}}
							>
								NEW · 核心差异化 #3
							</div>
							<div style={{ fontSize: 11, fontWeight: 700, color: C.cognition, marginBottom: 2 }}>
								④ 认知记忆 · Cognitive Memory
							</div>
							<div style={{ fontSize: 9, color: C.dim, marginBottom: 8, lineHeight: 1.4 }}>
								不是"关于你的信息"，是"你怎么想" · 你的认知框架、世界观、决策方法论
							</div>
							<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
								{["worldview.md", "ai-philosophy.md", "finance.md", "decision.md", "..."].map(
									(t, i) => (
										<span
											key={i}
											style={{
												fontSize: 8.5,
												color: C.cognition,
												background: `${C.cognition}15`,
												padding: "2px 8px",
												borderRadius: 4,
												fontFamily: "monospace",
											}}
										>
											{t}
										</span>
									),
								)}
							</div>
						</div>
					</Grid>

					{/* Cognitive Memory Deep Dive */}
					<div
						style={{
							marginTop: 10,
							padding: "14px 16px",
							borderRadius: 8,
							background: `${C.cognition}08`,
							border: `1px solid ${C.cognition}18`,
						}}
					>
						<div style={{ fontSize: 11, fontWeight: 800, color: C.cognition, marginBottom: 10 }}>
							认知记忆 · 详细设计
						</div>
						<Grid cols="1fr 1fr 1fr" gap={8}>
							<div>
								<div style={{ fontSize: 10, fontWeight: 700, color: C.text, marginBottom: 4 }}>
									存储格式
								</div>
								<div style={{ fontSize: 9, color: C.sub, lineHeight: 1.6 }}>
									每个认知模块 = 一个 Markdown 文件
									<br />
									结构化描述你对某领域的思维方式
									<br />
									不是 prompt template，不是 skill
									<br />
									是认知滤镜
								</div>
							</div>
							<div>
								<div style={{ fontSize: 10, fontWeight: 700, color: C.text, marginBottom: 4 }}>
									注入策略
								</div>
								<div style={{ fontSize: 9, color: C.sub, lineHeight: 1.6 }}>
									核心认知（worldview, decision）→ 常驻 system prompt
									<br />
									领域认知（finance, AI）→ 话题匹配时注入
									<br />
									优先级 {">"} facts {">"} episodes
								</div>
							</div>
							<div>
								<div style={{ fontSize: 10, fontWeight: 700, color: C.text, marginBottom: 4 }}>
									演化机制
								</div>
								<div style={{ fontSize: 9, color: C.sub, lineHeight: 1.6 }}>
									从对话中自动提取认知观点
									<br />
									不是追加，是修订（认知会变）
									<br />
									标记时间戳 + 演化原因
									<br />
									认知演化时间线可回溯
								</div>
							</div>
						</Grid>
						<div
							style={{
								marginTop: 10,
								padding: "8px 12px",
								borderRadius: 6,
								background: `${C.cognition}0a`,
								border: `1px dashed ${C.cognition}20`,
							}}
						>
							<div style={{ fontSize: 9, color: C.dim, lineHeight: 1.6 }}>
								<span style={{ color: C.cognition, fontWeight: 700 }}>为什么这很重要：</span>
								事实记忆让 agent 认识你，认知记忆让 agent 成为你的思维延伸。
								别人的 agent 知道你是 Leo、在 NYU 读经济。你的 agent 知道你认为 AGI 的到来是 input 和 output 的高效结合，
								并且会用这个框架去解读所有新信息。这是个性化的终极形态。
							</div>
						</div>
					</div>

					{/* Memory comparison table */}
					<div
						style={{
							marginTop: 10,
							padding: "12px 14px",
							borderRadius: 8,
							background: C.cardAlt,
							border: `1px solid ${C.border}`,
						}}
					>
						<div style={{ fontSize: 10, fontWeight: 700, color: C.sub, marginBottom: 8 }}>
							四层对比 · 人脑类比
						</div>
						<div style={{ display: "grid", gridTemplateColumns: "2fr 3fr 3fr 2fr", gap: 0 }}>
							{/* Header */}
							{["记忆层", "存什么", "人脑类比", "现有方案"].map((h, i) => (
								<div
									key={i}
									style={{
										fontSize: 8,
										fontWeight: 700,
										color: C.dim,
										padding: "4px 6px",
										borderBottom: `1px solid ${C.border}`,
										letterSpacing: "0.05em",
									}}
								>
									{h}
								</div>
							))}
							{/* Rows */}
							{[
								["工作记忆", "当前对话上下文", "即时处理缓冲", "成熟 ✓"],
								["情景记忆", "发生过什么", "海马体", "成熟 ✓"],
								["语义/程序", "知识 + 技能", "皮层存储", "基本可用 ✓"],
								["认知记忆", "怎么看事情", "前额叶连接模式", "空白 → Grava 填补"],
							].map((row, ri) =>
								row.map((cell, ci) => (
									<div
										key={`${ri}-${ci}`}
										style={{
											fontSize: 9,
											color: ri === 3 ? C.cognition : C.sub,
											fontWeight: ri === 3 ? 700 : 400,
											padding: "5px 6px",
											borderBottom: ri < 3 ? `1px solid ${C.border}40` : "none",
										}}
									>
										{cell}
									</div>
								)),
							)}
						</div>
					</div>
				</Card>

				{/* ═══════ 7: LLM PROVIDER ═══════ */}
				<Card
					color={C.llm}
					title="LLM Provider"
					badge="pi-ai 照旧"
					sub="统一 API · 审计层同时调用多 provider · 认知记忆注入 system prompt"
				>
					<Grid cols="1fr 1fr">
						<Mod
							name="pi-ai 统一层"
							color={C.llm}
							desc="4 协议归一化 · 300+ 模型 · 跨 Provider Context 移植"
							tags={["Streaming", "Tool schema", "Token/Cost 追踪", "Thinking/Reasoning"]}
						/>
						<div>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
								{[
									"Anthropic",
									"OpenAI",
									"Google",
									"Groq",
									"xAI",
									"DeepSeek",
									"Ollama",
									"Bedrock",
									"OpenRouter",
									"Mistral",
								].map((p) => (
									<div
										key={p}
										style={{
											fontSize: 9,
											color: C.sub,
											background: `${C.llm}08`,
											padding: "3px 8px",
											borderRadius: 4,
											textAlign: "center",
										}}
									>
										{p}
									</div>
								))}
							</div>
							<div style={{ marginTop: 8, fontSize: 9, color: C.dim, lineHeight: 1.4 }}>
								审计层调用 ≥2 家 → pi-ai 跨 provider context 移植让这变得 trivial
							</div>
						</div>
					</Grid>
				</Card>

				{/* ═══════ 8: FUTURE ═══════ */}
				<Card
					color={C.future}
					title="未来子模块 · Pluggable Sub-Modules"
					badge="规划中"
					sub="独立模块，可插拔挂载到 Agent Runtime · 每个 = Extension + Skills + Tools 包"
				>
					<Grid cols="1fr 1fr 1fr 1fr" gap={6}>
						<Mod
							name="Commodity Analytics"
							color={C.future}
							desc="期货/大宗商品"
							tags={["行情监控", "信号", "风险"]}
						/>
						<Mod
							name="Research Agent"
							color={C.future}
							desc="深度研究自动化"
							tags={["论文检索", "摘要", "知识图谱"]}
						/>
						<Mod
							name="Code Agent"
							color={C.future}
							desc="编码辅助"
							tags={["LSP?", "Git", "Review"]}
						/>
						<Mod name="???" color={C.future} desc="你的下一个想法" tags={["..."]} />
					</Grid>
				</Card>

				{/* ═══════ DATA FLOW ═══════ */}
				<Divider label="COMPLETE DATA FLOW" color={C.gold} />
				<div
					style={{
						padding: "14px 16px",
						borderRadius: 10,
						background: C.goldSoft,
						border: `1px solid ${C.gold}20`,
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							flexWrap: "wrap",
							gap: 5,
							fontSize: 10,
							lineHeight: 2.4,
						}}
					>
						{[
							{ t: "User Input", c: C.client },
							{ t: "→" },
							{ t: "Channel 归一化", c: C.client },
							{ t: "→" },
							{ t: "Gateway 路由", c: C.gateway },
							{ t: "→" },
							{ t: "AI Search 滤网", c: C.search },
							{ t: "→" },
							{ t: "认知记忆注入", c: C.cognition },
							{ t: "→" },
							{ t: "Agent Runtime", c: C.runtime },
							{ t: "→" },
							{ t: "LLM 生成", c: C.llm },
							{ t: "→" },
							{ t: "多方审计", c: C.audit },
							{ t: "→" },
							{ t: "User + Memory", c: C.memory },
						].map((item, i) =>
							item.c ? (
								<span
									key={i}
									style={{
										color: item.c,
										fontWeight: 700,
										background: `${item.c}12`,
										padding: "2px 8px",
										borderRadius: 4,
									}}
								>
									{item.t}
								</span>
							) : (
								<span key={i} style={{ color: C.dim, fontSize: 11 }}>
									{item.t}
								</span>
							),
						)}
					</div>
					<div style={{ fontSize: 9, color: C.dim, marginTop: 6 }}>
						v0.3 新增：认知记忆在 Search 之后、Runtime 之前注入 system prompt，作为持续生效的"认知滤镜"
					</div>
				</div>

				{/* ═══════ THREE MOATS ═══════ */}
				<Divider label="THREE COMPETITIVE MOATS" color={C.gold} />
				<Grid cols="1fr 1fr 1fr" gap={8}>
					<div
						style={{
							padding: "14px",
							borderRadius: 8,
							background: `${C.search}08`,
							border: `1px solid ${C.search}18`,
						}}
					>
						<div style={{ fontSize: 9, fontWeight: 700, color: C.search, marginBottom: 4 }}>
							护城河 ①
						</div>
						<div style={{ fontSize: 12, fontWeight: 800, color: C.text, marginBottom: 6 }}>Input 端</div>
						<div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>
							AI Search 前置滤网
						</div>
						<div style={{ fontSize: 9, color: C.sub, lineHeight: 1.6 }}>
							LLM 基于事实回答，不基于幻觉。搜索结果作为 grounding，让模型有据可依。
						</div>
					</div>
					<div
						style={{
							padding: "14px",
							borderRadius: 8,
							background: `${C.audit}08`,
							border: `1px solid ${C.audit}18`,
						}}
					>
						<div style={{ fontSize: 9, fontWeight: 700, color: C.audit, marginBottom: 4 }}>
							护城河 ②
						</div>
						<div style={{ fontSize: 12, fontWeight: 800, color: C.text, marginBottom: 6 }}>
							Output 端
						</div>
						<div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>
							多方审计层
						</div>
						<div style={{ fontSize: 9, color: C.sub, lineHeight: 1.6 }}>
							不信任单一 LLM。多模型交叉验证 + 事实核验，给 user 决策支撑而非答案。
						</div>
					</div>
					<div
						style={{
							padding: "14px",
							borderRadius: 8,
							background: `${C.cognition}08`,
							border: `1px solid ${C.cognition}18`,
						}}
					>
						<div style={{ fontSize: 9, fontWeight: 700, color: C.cognition, marginBottom: 4 }}>
							护城河 ③
						</div>
						<div style={{ fontSize: 12, fontWeight: 800, color: C.text, marginBottom: 6 }}>认知层</div>
						<div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>
							认知记忆体系
						</div>
						<div style={{ fontSize: 9, color: C.sub, lineHeight: 1.6 }}>
							不只存你的事实，存你的思维方式。agent 不是认识你，是成为你的思维延伸。
						</div>
					</div>
				</Grid>

				{/* ═══════ BOTTOM SUMMARY ═══════ */}
				<div
					style={{
						marginTop: 8,
						padding: "14px 16px",
						borderRadius: 10,
						background: `${C.gold}0a`,
						border: `1px solid ${C.gold}18`,
					}}
				>
					<div style={{ fontSize: 11, fontWeight: 800, color: C.gold, marginBottom: 4 }}>
						三端保障 · Input 净化 + 认知注入 + Output 审计
					</div>
					<div style={{ fontSize: 9.5, color: C.dim, lineHeight: 1.6 }}>
						别人：User → LLM → 直出（单点故障，无个性）
						<br />
						Grava：User → 事实检索 → 认知滤镜 → LLM → 多方审计 → 决策支撑（三端校验，深度个性化）
					</div>
				</div>
			</div>
		</div>
	);
}
