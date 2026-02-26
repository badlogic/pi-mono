# OpenClaw 仓库 Prompt 研究文档

本文档收集了 OpenClaw 仓库中所有的 prompt（摘要和引用信息），整理成表格形式。

---

## 一、系统提示词 (System Prompts)

### 1.1 主系统提示词构建函数

| 文件路径 | Prompt 名称 | 摘要 | 用途 |
|---------|------------|------|------|
| [src/agents/system-prompt.ts](file:///d:/temp/openclaw/src/agents/system-prompt.ts) | `buildAgentSystemPrompt()` | 构建 OpenClaw agent 的完整系统提示词，包含工具列表、安全规则、技能、工作空间、时间、消息等功能模块 | 主 Agent 系统提示词生成 |

### 1.2 系统提示词核心组成部分

| 模块名称 | 摘要 | 引用位置 |
|---------|------|---------|
| **Tooling** | 当前可用工具列表及简短描述，工具名称区分大小写 | [system-prompt.ts:Tooling](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L420-L440) |
| **Safety** | 安全护栏提醒，避免权力寻求行为或绕过监督 | [system-prompt.ts:Safety](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L376-L380) |
| **Skills** | 告知模型如何按需加载技能指令，包含 `<available_skills>` 元数据 | [system-prompt.ts:Skills](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L38-L55) |
| **OpenClaw Self-Update** | 如何运行 `config.apply` 和 `update.run` | [system-prompt.ts:Self-Update](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L450-L460) |
| **Workspace** | 工作目录路径及相关指导 | [system-prompt.ts:Workspace](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L475-L480) |
| **Documentation** | 本地 OpenClaw 文档路径及公共镜像链接 | [system-prompt.ts:Docs](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L118-L132) |
| **Current Date & Time** | 用户本地时区信息 | [system-prompt.ts:Time](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L66-L72) |
| **Reply Tags** | 支持的回复标签语法（如 `[[reply_to_current]]`） | [system-prompt.ts:ReplyTags](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L74-L87) |
| **Messaging** | 消息路由规则，包括跨会话消息和子代理编排 | [system-prompt.ts:Messaging](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L89-L120) |
| **Heartbeats** | 心跳提示词和确认行为 | [system-prompt.ts:Heartbeats](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L620-L630) |
| **Runtime** | 运行时元数据（主机/OS/模型/thinking） | [system-prompt.ts:Runtime](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L635-L645) |
| **Sandbox** | 沙箱运行时信息（Docker 路径、权限等） | [system-prompt.ts:Sandbox](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L485-L515) |

### 1.3 Prompt 模式

| 模式 | 摘要 | 引用位置 |
|-----|------|---------|
| `full` | 默认模式，包含所有部分 | [system-prompt.ts:PromptMode](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L17-L20) |
| `minimal` | 子代理模式，省略 Skills、Memory、Self-Update 等部分 | [system-prompt.ts:PromptMode](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L17-L20) |
| `none` | 仅返回基础身份行 | [system-prompt.ts:PromptMode](file:///d:/temp/openclaw/src/agents/system-prompt.ts#L17-L20) |

---

## 二、翻译提示词 (Translation Prompts)

### 2.1 文档国际化翻译提示词

| 文件路径 | Prompt 名称 | 摘要 | 目标语言 |
|---------|------------|------|---------|
| [scripts/docs-i18n/prompt.go](file:///d:/temp/openclaw/scripts/docs-i18n/prompt.go) | `zhCNPromptTemplate` | 将文档从英文翻译为简体中文，保留 YAML 结构、Markdown 语法、代码块等 | 简体中文 (zh-CN) |
| [scripts/docs-i18n/prompt.go](file:///d:/temp/openclaw/scripts/docs-i18n/prompt.go) | `jaJPPromptTemplate` | 将文档从英文翻译为日文，保留 YAML 结构、Markdown 语法、代码块等 | 日文 (ja-JP) |
| [scripts/docs-i18n/prompt.go](file:///d:/temp/openclaw/scripts/docs-i18n/prompt.go) | `genericPromptTemplate` | 通用翻译模板，支持任意语言对 | 通用 |

### 2.2 翻译提示词核心规则

| 规则 | 摘要 |
|-----|------|
| 输出格式 | 仅输出翻译文本，无前言、问题或评论 |
| 代码保留 | 不翻译代码跨度/块、配置键、CLI 标志、环境变量 |
| URL 保留 | 不更改 URL 或锚点 |
| 占位符保留 | 精确保留 `__OC_I18N_####__` 占位符 |
| 产品名称 | 保持英文：OpenClaw, Pi, WhatsApp, Telegram, Discord 等 |
| 术语保留 | 保持英文：Skills, local loopback, Tailscale |

---

## 三、会话重置提示词

| 文件路径 | Prompt 名称 | 摘要 | 引用内容 |
|---------|------------|------|---------|
| [src/auto-reply/reply/session-reset-prompt.ts](file:///d:/temp/openclaw/src/auto-reply/reply/session-reset-prompt.ts) | `BARE_SESSION_RESET_PROMPT` | 新会话启动时的问候提示 | "A new session was started via /new or /reset. Greet the user in your configured persona..." |

---

## 四、OpenProse VM 提示词

### 4.1 OpenProse VM 系统提示词强制执行

| 文件路径 | 摘要 | 用途 |
|---------|------|------|
| [extensions/open-prose/skills/prose/guidance/system-prompt.md](file:///d:/temp/openclaw/extensions/open-prose/skills/prose/guidance/system-prompt.md) | OpenProse VM 实例的严格系统提示词附加内容，强制代理仅执行 .prose 程序 | OpenProse 专用执行实例 |

### 4.2 OpenProse VM 核心原则

| 原则 | 摘要 |
|-----|------|
| 严格结构 | 完全按照程序结构执行 |
| 智能评估 | 仅对裁量条件 (`**...**`) 使用判断 |
| 真实执行 | 每个 `session` 通过 Task 工具生成真实子代理 |
| 状态持久化 | 在 `.prose/runs/{id}/` 或通过叙述协议跟踪状态 |

### 4.3 OpenProse 示例程序 Prompt

| 文件路径 | 示例名称 | 摘要 |
|---------|---------|------|
| [extensions/open-prose/skills/prose/examples/36-bug-hunter.prose](file:///d:/temp/openclaw/extensions/open-prose/skills/prose/examples/36-bug-hunter.prose) | Bug Hunter | 系统化调查、诊断和修复 bug 的程序，包含侦探和外科医生两个代理角色 |

---

## 五、A2UI 评估测试提示词

### 5.1 v0.9 版本测试提示词

| 文件路径 | 摘要 | 提示词数量 |
|---------|------|-----------|
| [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | UI 生成测试提示词集合，用于评估模型生成 JSON UI 消息的能力 | 30+ 个测试提示词 |

### 5.2 v0.8 版本测试提示词

| 文件路径 | 摘要 | 提示词数量 |
|---------|------|-----------|
| [vendor/a2ui/specification/0.8/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.8/eval/src/prompts.ts) | UI 生成测试提示词集合，包含 Schema 匹配器 | 30+ 个测试提示词 |

### 5.3 主要测试提示词类型

| 提示词名称 | 摘要 |
|-----------|------|
| `deleteSurface` | 删除 UI 表面的消息 |
| `dogBreedGenerator` | 狗品种信息和生成器工具 UI |
| `loginForm` | 简单登录表单 |
| `productGallery` | 使用模板的产品画廊 |
| `settingsPage` | 带标签和模态对话框的设置页面 |
| `animalKingdomExplorer` | 动物王国层级结构展示 |
| `recipeCard` | 食谱卡片（配料和说明） |
| `musicPlayer` | 简单音乐播放器 UI |
| `weatherForecast` | 天气预报显示 |
| `surveyForm` | 客户反馈调查表单 |
| `flightBooker` | 航班搜索表单 |
| `dashboard` | 简单统计仪表板 |
| `contactCard` | 联系人信息卡片 |
| `calendarEventCreator` | 日历事件创建表单 |
| `checkoutPage` | 简化电商结账页面 |
| `socialMediaPost` | 社交媒体帖子组件 |
| `eCommerceProductPage` | 电商产品详情页 |
| `interactiveDashboard` | 带过滤器的交互式仪表板 |
| `travelItinerary` | 多日旅行行程展示 |
| `kanbanBoard` | 看板风格任务跟踪板 |
| `videoCallInterface` | 视频会议 UI |
| `fileBrowser` | 文件浏览器列表 |
| `chatRoom` | 聊天应用界面 |
| `fitnessTracker` | 每日活动摘要 |
| `smartHome` | 智能家居控制面板 |
| `restaurantMenu` | 带标签的餐厅菜单 |
| `newsAggregator` | 带文章卡片的新闻源 |

---

## 六、Skill 提示词

### 6.1 Skill 创建器

| 文件路径 | 摘要 | 关键 Prompt 内容 |
|---------|------|-----------------|
| [skills/skill-creator/SKILL.md](file:///d:/temp/openclaw/skills/skill-creator/SKILL.md) | 创建或更新 AgentSkills 的指导 | 包含 Skill 解剖结构、渐进式披露设计原则、创建流程等 |

### 6.2 其他 Skill 示例

| 文件路径 | Skill 名称 | 摘要 |
|---------|-----------|------|
| [skills/summarize/SKILL.md](file:///d:/temp/openclaw/skills/summarize/SKILL.md) | summarize | 总结或提取 URL、播客和本地文件的文本/转录 |
| [skills/github/SKILL.md](file:///d:/temp/openclaw/skills/github/SKILL.md) | github | 通过 `gh` CLI 进行 GitHub 操作 |

---

## 七、向导提示词类型定义

| 文件路径 | 类型名称 | 摘要 |
|---------|---------|------|
| [src/wizard/prompts.ts](file:///d:/temp/openclaw/src/wizard/prompts.ts) | `WizardPrompter` | 向导提示器接口，包含 intro、outro、note、select、multiselect、text、confirm、progress 方法 |
| [src/wizard/prompts.ts](file:///d:/temp/openclaw/src/wizard/prompts.ts) | `WizardSelectParams` | 单选提示参数 |
| [src/wizard/prompts.ts](file:///d:/temp/openclaw/src/wizard/prompts.ts) | `WizardMultiSelectParams` | 多选提示参数 |
| [src/wizard/prompts.ts](file:///d:/temp/openclaw/src/wizard/prompts.ts) | `WizardTextParams` | 文本输入提示参数 |
| [src/wizard/prompts.ts](file:///d:/temp/openclaw/src/wizard/prompts.ts) | `WizardConfirmParams` | 确认提示参数 |

---

## 八、CLI 提示词

| 文件路径 | 函数名称 | 摘要 |
|---------|---------|------|
| [src/cli/prompt.ts](file:///d:/temp/openclaw/src/cli/prompt.ts) | `promptYesNo()` | 简单的 Y/N 提示，支持全局 --yes 和详细标志 |

---

## 九、Gateway 配置提示词

| 文件路径 | 常量名称 | 摘要 |
|---------|---------|------|
| [src/gateway/gateway-config-prompts.shared.ts](file:///d:/temp/openclaw/src/gateway/gateway-config-prompts.shared.ts) | `TAILSCALE_EXPOSURE_OPTIONS` | Tailscale 暴露选项配置 |
| [src/gateway/gateway-config-prompts.shared.ts](file:///d:/temp/openclaw/src/gateway/gateway-config-prompts.shared.ts) | `TAILSCALE_MISSING_BIN_NOTE_LINES` | Tailscale 二进制文件缺失提示 |
| [src/gateway/gateway-config-prompts.shared.ts](file:///d:/temp/openclaw/src/gateway/gateway-config-prompts.shared.ts) | `TAILSCALE_DOCS_LINES` | Tailscale 文档链接 |

---

## 十、Agent 消息构建

| 文件路径 | 函数名称 | 摘要 |
|---------|---------|------|
| [src/gateway/agent-prompt.ts](file:///d:/temp/openclaw/src/gateway/agent-prompt.ts) | `buildAgentMessageFromConversationEntries()` | 从会话条目构建代理消息，优先使用最后的用户/工具条目作为"当前消息" |

---

## 十一、文档参考

| 文件路径 | 标题 | 摘要 |
|---------|------|------|
| [docs/concepts/system-prompt.md](file:///d:/temp/openclaw/docs/concepts/system-prompt.md) | System Prompt | OpenClaw 系统提示词的组成结构和注入行为说明 |
| [docs/zh-CN/concepts/system-prompt.md](file:///d:/temp/openclaw/docs/zh-CN/concepts/system-prompt.md) | 系统提示词（中文版） | 系统提示词概念的中文翻译版 |
| [docs/reference/token-use.md](file:///d:/temp/openclaw/docs/reference/token-use.md) | Token Use and Costs | OpenClaw 如何构建提示词上下文并报告 token 使用量和成本 |

---

## 十二、Prompt 相关文件清单

以下是仓库中所有与 prompt 相关的文件完整列表：

### 12.1 核心系统提示词文件

| 文件路径 | 描述 |
|---------|------|
| `src/agents/system-prompt.ts` | 主系统提示词构建函数 |
| `src/agents/system-prompt-params.ts` | 系统提示词参数类型 |
| `src/agents/system-prompt-report.ts` | 系统提示词报告 |
| `src/agents/sanitize-for-prompt.ts` | 提示词内容清理 |
| `src/agents/pi-embedded-runner/system-prompt.ts` | PI 嵌入式运行器系统提示词 |

### 12.2 向导和 CLI 提示词

| 文件路径 | 描述 |
|---------|------|
| `src/wizard/prompts.ts` | 向导提示词类型定义 |
| `src/wizard/clack-prompter.ts` | Clack 提示器实现 |
| `src/cli/prompt.ts` | CLI 提示词函数 |
| `src/commands/doctor-prompter.ts` | Doctor 命令提示器 |
| `src/commands/auth-choice-prompt.ts` | 认证选择提示 |

### 12.3 自动回复提示词

| 文件路径 | 描述 |
|---------|------|
| `src/auto-reply/reply/session-reset-prompt.ts` | 会话重置提示词 |
| `src/auto-reply/reply/commands-system-prompt.ts` | 命令系统提示词 |

### 12.4 Gateway 提示词

| 文件路径 | 描述 |
|---------|------|
| `src/gateway/agent-prompt.ts` | 代理消息构建 |
| `src/gateway/gateway-config-prompts.shared.ts` | Gateway 配置共享提示词 |

### 12.5 终端提示词样式

| 文件路径 | 描述 |
|---------|------|
| `src/terminal/prompt-style.ts` | 终端提示词样式 |

### 12.6 翻译脚本提示词

| 文件路径 | 描述 |
|---------|------|
| `scripts/docs-i18n/prompt.go` | 文档国际化翻译提示词模板 |

### 12.7 扩展和 Skill 提示词

| 文件路径 | 描述 |
|---------|------|
| `extensions/open-prose/skills/prose/guidance/system-prompt.md` | OpenProse VM 系统提示词强制执行 |
| `extensions/open-prose/skills/prose/prose.md` | OpenProse VM 执行语义 |
| `extensions/open-prose/skills/prose/examples/36-bug-hunter.prose` | Bug Hunter 示例程序 |

### 12.8 第三方测试提示词

| 文件路径 | 描述 |
|---------|------|
| `vendor/a2ui/specification/0.9/eval/src/prompts.ts` | A2UI v0.9 评估测试提示词 |
| `vendor/a2ui/specification/0.8/eval/src/prompts.ts` | A2UI v0.8 评估测试提示词 |

### 12.9 测试文件

| 文件路径 | 描述 |
|---------|------|
| `src/agents/system-prompt.e2e.test.ts` | 系统提示词 E2E 测试 |
| `src/wizard/clack-prompter.test.ts` | Clack 提示器测试 |
| `src/cli/prompt.test.ts` | CLI 提示词测试 |
| `src/gateway/agent-prompt.e2e.test.ts` | 代理提示词 E2E 测试 |

---

## 十三、总结

OpenClaw 仓库中的 prompt 主要分为以下几类：

1. **系统提示词** - 核心 agent 运行时的提示词构建系统
2. **翻译提示词** - 文档国际化的翻译模板
3. **会话管理提示词** - 会话重置和消息构建
4. **OpenProse VM 提示词** - 专门用于执行 .prose 程序的 VM 实例
5. **测试评估提示词** - UI 生成能力评估的测试集
6. **Skill 提示词** - 各种技能模块的指导文档
7. **向导/CLI 提示词** - 用户交互向导和命令行提示

这些 prompt 共同构成了 OpenClaw 的智能代理系统，使其能够在各种场景下提供准确、安全、高效的服务。
