# OpenClaw Prompt 研究文档

本文档收集了 OpenClaw 仓库中所有的 prompt 定义，包括系统提示词、功能提示词和配置模板。

## 系统提示词 (System Prompts)

| 名称 | 文件路径 | 类型 | 描述/摘要 |
|------|----------|------|-----------|
| buildAgentSystemPrompt | [src/agents/system-prompt.ts](file:///d:/temp/openclaw/src/agents/system-prompt.ts) | Function | 构建 Agent 系统提示词的主函数，支持 full/minimal/none 三种模式 |
| buildEmbeddedSystemPrompt | [src/agents/pi-embedded-runner/system-prompt.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/system-prompt.ts) | Function | 构建嵌入式系统提示词，用于 Pi Embedded Runner |
| buildSubagentSystemPrompt | [src/agents/subagent-announce.ts](file:///d:/temp/openclaw/src/agents/subagent-announce.ts) | Function | 构建子 Agent 系统提示词，定义子代理的角色和规则 |
| buildSystemPrompt (CLI) | [src/agents/cli-runner/helpers.ts](file:///d:/temp/openclaw/src/agents/cli-runner/helpers.ts) | Function | 为 CLI 运行器构建系统提示词 |
| buildInboundMetaSystemPrompt | [src/auto-reply/reply/inbound-meta.ts](file:///d:/temp/openclaw/src/auto-reply/reply/inbound-meta.ts) | Function | 构建入站消息元数据的系统提示词 |
| resolveCommandsSystemPromptBundle | [src/auto-reply/reply/commands-system-prompt.ts](file:///d:/temp/openclaw/src/auto-reply/reply/commands-system-prompt.ts) | Function | 解析命令系统提示词包，包含工具、技能和注入文件 |
| BARE_SESSION_RESET_PROMPT | [src/auto-reply/reply/session-reset-prompt.ts](file:///d:/temp/openclaw/src/auto-reply/reply/session-reset-prompt.ts) | Const | 会话重置提示词，用于 /new 或 /reset 后的问候 |
| HEARTBEAT_PROMPT | [src/auto-reply/heartbeat.ts](file:///d:/temp/openclaw/src/auto-reply/heartbeat.ts) | Const | 默认心跳提示词，指导 Agent 读取 HEARTBEAT.md |
| buildCronEventPrompt | [src/infra/heartbeat-events-filter.ts](file:///d:/temp/openclaw/src/infra/heartbeat-events-filter.ts) | Function | 构建 Cron 事件提示词，用于定时提醒 |
| resolveHeartbeatPrompt | [src/infra/heartbeat-runner.ts](file:///d:/temp/openclaw/src/infra/heartbeat-runner.ts) | Function | 解析心跳提示词配置 |
| MEMORY_SYSTEM_PROMPT | [src/commands/doctor-workspace.ts](file:///d:/temp/openclaw/src/commands/doctor-workspace.ts) | Const | 内存系统安装提示词，用于引导用户安装记忆系统 |
| DEFAULT_MEMORY_FLUSH_PROMPT | [src/auto-reply/reply/memory-flush.ts](file:///d:/temp/openclaw/src/auto-reply/reply/memory-flush.ts) | Const | 内存刷新提示词，在压缩前存储持久记忆 |
| DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT | [src/auto-reply/reply/memory-flush.ts](file:///d:/temp/openclaw/src/auto-reply/reply/memory-flush.ts) | Const | 内存刷新系统提示词 |
| buildTtsSystemPromptHint | [src/tts/tts.ts](file:///d:/temp/openclaw/src/tts/tts.ts) | Function | 构建 TTS 系统提示词提示，指导语音合成功能使用 |
| buildSafeExternalPrompt | [src/security/external-content.ts](file:///d:/temp/openclaw/src/security/external-content.ts) | Function | 构建安全的外部内容提示词，包装外部来源内容 |
| buildQueueSummaryPrompt | [src/utils/queue-helpers.ts](file:///d:/temp/openclaw/src/utils/queue-helpers.ts) | Function | 构建队列摘要提示词，用于队列溢出时 |
| buildCollectPrompt | [src/utils/queue-helpers.ts](file:///d:/temp/openclaw/src/utils/queue-helpers.ts) | Function | 构建收集提示词，用于汇总项目 |
| OpenProse VM System Prompt | [extensions/open-prose/skills/prose/guidance/system-prompt.md](file:///d:/temp/openclaw/extensions/open-prose/skills/prose/guidance/system-prompt.md) | Markdown | OpenProse VM 专用系统提示词，强制执行 .prose 程序执行 |

## Pi 扩展 Prompts

| 名称 | 文件路径 | 类型 | 描述/摘要 |
|------|----------|------|-----------|
| cl (Changelog) | [.pi/prompts/cl.md](file:///d:/temp/openclaw/.pi/prompts/cl.md) | Markdown | 审计发布前的 Changelog 条目，检查提交记录和变更日志 |
| is (Issue Analysis) | [.pi/prompts/is.md](file:///d:/temp/openclaw/.pi/prompts/is.md) | Markdown | 分析 GitHub Issue（Bug 或功能请求），追踪代码路径 |
| landpr (PR Landing) | [.pi/prompts/landpr.md](file:///d:/temp/openclaw/.pi/prompts/landpr.md) | Markdown | 合并 PR 的完整工作流，包括 rebase/squash 策略 |

## A2UI 测试 Prompts

| 名称 | 文件路径 | 类型 | 描述/摘要 |
|------|----------|------|-----------|
| deleteSurface | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 生成删除 UI 表面的 JSON 消息 |
| dogBreedGenerator | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 生成狗狗品种信息和生成器工具的 UI |
| loginForm | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 简单的登录表单，包含用户名、密码和记住我选项 |
| productGallery | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 使用模板列表的产品画廊 |
| productGalleryData | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 填充产品画廊数据的 updateDataModel 消息 |
| settingsPage | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 带标签页和模态对话框的设置页面 |
| updateDataModel | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 更新用户数据的 DataModelUpdate 消息 |
| animalKingdomExplorer | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 显示动物层次结构的简化 UI 浏览器 |
| recipeCard | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 显示食谱的 UI，包含配料和说明 |
| musicPlayer | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 简单的音乐播放器 UI |
| weatherForecast | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 显示天气预报的 UI |
| surveyForm | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 客户反馈调查表单 |
| flightBooker | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 航班搜索表单 |
| dashboard | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 带统计信息的简单仪表板 |
| contactCard | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 显示联系信息的 UI |
| calendarEventCreator | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 创建日历事件的表单 |
| checkoutPage | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 简化的电商结账页面 |
| socialMediaPost | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 社交媒体帖子组件 |
| eCommerceProductPage | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 电商网站详细产品页面 |
| interactiveDashboard | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 带过滤器的数据卡片交互式仪表板 |
| travelItinerary | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 多日旅行行程显示 |
| kanbanBoard | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 看板式任务跟踪板 |
| videoCallInterface | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 视频会议 UI |
| fileBrowser | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 文件浏览器列表 |
| chatRoom | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 聊天应用界面 |
| fitnessTracker | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 每日活动摘要 |
| smartHome | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 智能家居控制面板 |
| restaurantMenu | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 带标签的餐厅菜单 |
| newsAggregator | [vendor/a2ui/specification/0.9/eval/src/prompts.ts](file:///d:/temp/openclaw/vendor/a2ui/specification/0.9/eval/src/prompts.ts) | TestPrompt | 带文章卡片的新闻源 |

## 交互式 Prompts (Wizard/CLI)

| 名称 | 文件路径 | 类型 | 描述/摘要 |
|------|----------|------|-----------|
| WizardPrompter | [src/wizard/prompts.ts](file:///d:/temp/openclaw/src/wizard/prompts.ts) | Type | 向导提示器类型定义，包含 select/multiselect/text/confirm 等方法 |
| createClackPrompter | [src/wizard/clack-prompter.ts](file:///d:/temp/openclaw/src/wizard/clack-prompter.ts) | Function | 创建基于 Clack 的交互式提示器 |
| promptYesNo | [src/cli/prompt.ts](file:///d:/temp/openclaw/src/cli/prompt.ts) | Function | 简单的 Y/N 提示，支持全局 --yes 标志 |
| DoctorPrompter | [src/commands/doctor-prompter.ts](file:///d:/temp/openclaw/src/commands/doctor-prompter.ts) | Type | Doctor 命令的提示器接口 |
| createDoctorPrompter | [src/commands/doctor-prompter.ts](file:///d:/temp/openclaw/src/commands/doctor-prompter.ts) | Function | 创建 Doctor 命令的交互式提示器 |
| promptAuthChoiceGrouped | [src/commands/auth-choice-prompt.ts](file:///d:/temp/openclaw/src/commands/auth-choice-prompt.ts) | Function | 分组提示认证选择 |
| stylePromptMessage | [src/terminal/prompt-style.ts](file:///d:/temp/openclaw/src/terminal/prompt-style.ts) | Function | 样式化提示消息（带主题支持） |
| stylePromptTitle | [src/terminal/prompt-style.ts](file:///d:/temp/openclaw/src/terminal/prompt-style.ts) | Function | 样式化提示标题 |
| stylePromptHint | [src/terminal/prompt-style.ts](file:///d:/temp/openclaw/src/terminal/prompt-style.ts) | Function | 样式化提示提示文本 |

## 配置和工具 Prompts

| 名称 | 文件路径 | 类型 | 描述/摘要 |
|------|----------|------|-----------|
| buildSystemPromptParams | [src/agents/system-prompt-params.ts](file:///d:/temp/openclaw/src/agents/system-prompt-params.ts) | Function | 构建系统提示词运行时参数（时区、时间等） |
| buildSystemPromptReport | [src/agents/system-prompt-report.ts](file:///d:/temp/openclaw/src/agents/system-prompt-report.ts) | Function | 构建系统提示词报告，用于分析提示词组成 |
| buildWorkspaceSkillsPrompt | [src/agents/skills/workspace.ts](file:///d:/temp/openclaw/src/agents/skills/workspace.ts) | Function | 构建工作区技能提示词 |
| resolveSkillsPromptForRun | [src/agents/skills/workspace.ts](file:///d:/temp/openclaw/src/agents/skills/workspace.ts) | Function | 解析运行时的技能提示词 |
| sanitizeForPromptLiteral | [src/agents/sanitize-for-prompt.ts](file:///d:/temp/openclaw/src/agents/sanitize-for-prompt.ts) | Function | 清理提示词字面量中的控制字符 |
| TAILSCALE_EXPOSURE_OPTIONS | [src/gateway/gateway-config-prompts.shared.ts](file:///d:/temp/openclaw/src/gateway/gateway-config-prompts.shared.ts) | Const | Tailscale 暴露选项配置 |
| TAILSCALE_MISSING_BIN_NOTE_LINES | [src/gateway/gateway-config-prompts.shared.ts](file:///d:/temp/openclaw/src/gateway/gateway-config-prompts.shared.ts) | Const | Tailscale 二进制缺失提示 |
| TAILSCALE_DOCS_LINES | [src/gateway/gateway-config-prompts.shared.ts](file:///d:/temp/openclaw/src/gateway/gateway-config-prompts.shared.ts) | Const | Tailscale 文档链接 |
| translationPrompt | [scripts/docs-i18n/prompt.go](file:///d:/temp/openclaw/scripts/docs-i18n/prompt.go) | Function | 文档国际化翻译提示词（Go） |
| zhCNPromptTemplate | [scripts/docs-i18n/prompt.go](file:///d:/temp/openclaw/scripts/docs-i18n/prompt.go) | Const | 中文翻译提示词模板 |
| jaJPPromptTemplate | [scripts/docs-i18n/prompt.go](file:///d:/temp/openclaw/scripts/docs-i18n/prompt.go) | Const | 日文翻译提示词模板 |
| genericPromptTemplate | [scripts/docs-i18n/prompt.go](file:///d:/temp/openclaw/scripts/docs-i18n/prompt.go) | Const | 通用翻译提示词模板 |

## 媒体理解 Prompts

| 名称 | 文件路径 | 类型 | 描述/摘要 |
|------|----------|------|-----------|
| DEFAULT_PROMPT | [src/media-understanding/defaults.ts](file:///d:/temp/openclaw/src/media-understanding/defaults.ts) | Const | 默认媒体理解提示词（图像/音频/视频） |
| DEFAULT_PROMPT.image | [src/media-understanding/defaults.ts](file:///d:/temp/openclaw/src/media-understanding/defaults.ts) | Const | "Describe the image." |
| DEFAULT_PROMPT.audio | [src/media-understanding/defaults.ts](file:///d:/temp/openclaw/src/media-understanding/defaults.ts) | Const | "Transcribe the audio." |
| DEFAULT_PROMPT.video | [src/media-understanding/defaults.ts](file:///d:/temp/openclaw/src/media-understanding/defaults.ts) | Const | "Describe the video." |

## 文档和概念

| 名称 | 文件路径 | 类型 | 描述/摘要 |
|------|----------|------|-----------|
| System Prompt 概念文档 | [docs/concepts/system-prompt.md](file:///d:/temp/openclaw/docs/concepts/system-prompt.md) | Markdown | 系统提示词的完整说明，包含结构和模式 |
| 系统提示词概念文档 (中文) | [docs/zh-CN/concepts/system-prompt.md](file:///d:/temp/openclaw/docs/zh-CN/concepts/system-prompt.md) | Markdown | 系统提示词的中文翻译版本 |

## Prompt 扩展和插件

| 名称 | 文件路径 | 类型 | 描述/摘要 |
|------|----------|------|-----------|
| promptUrlWidgetExtension | [.pi/extensions/prompt-url-widget.ts](file:///d:/temp/openclaw/.pi/extensions/prompt-url-widget.ts) | Function | Pi 扩展：从提示词中提取 GitHub PR/Issue URL 并显示小部件 |

## 核心 Prompt 内容摘要

### 1. 主系统提示词 (buildAgentSystemPrompt)

**文件**: `src/agents/system-prompt.ts`

主要包含以下部分：
- **Tooling**: 当前工具列表和简短描述
- **Safety**: 安全防护提醒，避免追求权力的行为
- **OpenClaw CLI Quick Reference**: CLI 快速参考
- **Skills**: 可用技能列表和使用说明
- **Memory Recall**: 记忆召回功能说明
- **OpenClaw Self-Update**: 自更新功能说明
- **Model Aliases**: 模型别名配置
- **Workspace**: 工作目录信息
- **Sandbox**: 沙箱运行时信息（如启用）
- **Current Date & Time**: 用户本地时间和时区
- **Reply Tags**: 回复标签语法
- **Messaging**: 消息发送指南
- **Heartbeats**: 心跳提示词行为
- **Runtime**: 运行时信息（主机、OS、Node、模型等）
- **Reasoning**: 推理级别和切换提示

### 2. 子 Agent 系统提示词 (buildSubagentSystemPrompt)

**文件**: `src/agents/subagent-announce.ts`

核心内容：
- 定义子代理的角色和任务
- 规则：保持专注、完成任务、不主动发起、短暂存在
- 输出格式要求
- 禁止事项：不与用户对话、不发送外部消息、不设置定时任务
- 支持嵌套子代理（如果深度允许）

### 3. 心跳提示词 (HEARTBEAT_PROMPT)

**文件**: `src/auto-reply/heartbeat.ts`

内容：
```
Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. 
Do not infer or repeat old tasks from prior chats. 
If nothing needs attention, reply HEARTBEAT_OK.
```

### 4. OpenProse VM 系统提示词

**文件**: `extensions/open-prose/skills/prose/guidance/system-prompt.md`

关键要点：
- 实例专用于执行 OpenProse (.prose) 程序
- Agent 就是 OpenProse VM 本身
- 执行模型：会话 = 函数调用，上下文按引用传递
- 状态管理：文件系统状态在 `.prose/runs/{id}/`
- 严格规则：不执行非 Prose 代码，不回答一般编程问题

### 5. Pi 扩展 Prompts

**cl.md** - Changelog 审计：
- 查找最后一个发布标签
- 列出该标签以来的所有提交
- 检查每个包的 [Unreleased] 部分
- 验证变更日志条目格式

**is.md** - Issue 分析：
- 完整阅读 Issue 和评论
- 对于 Bug：忽略 Issue 中的根因分析，自己追踪代码路径
- 对于功能请求：提出最简洁的实现方法

**landpr.md** - PR 合并：
- 分配 PR 给自己
- 创建临时基础分支
- Rebase PR 分支
- 修复 + 测试 + 更新 Changelog
- 决定合并策略（rebase 或 squash）
- 使用 committer 提交
- 强制推送并合并

## Prompt 模式说明

系统提示词支持三种模式：

1. **full** (默认): 包含所有部分
2. **minimal**: 用于子代理，省略 Skills、Memory Recall、Self-Update、Model Aliases 等
3. **none**: 仅返回基本身份行

## 文件统计

- TypeScript 文件中的 Prompt 定义: ~40 个
- Markdown 文件中的 Prompt 模板: ~5 个
- Go 文件中的 Prompt 模板: ~4 个
- 测试 Prompts (A2UI): ~30 个

---

*文档生成时间: 2026-02-18*
*研究范围: OpenClaw 完整仓库*
