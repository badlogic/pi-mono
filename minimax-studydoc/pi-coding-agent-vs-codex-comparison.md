# pi-coding-agent 与 OpenAI Codex 深度对比研究报告

## 摘要

本报告基于 Gergely Orosz 的深度文章 [How Codex is built](https://newsletter.pragmaticengineer.com/p/how-codex-is-built)，结合对 pi-coding-agent 源代码的详细分析，对两款编程辅助 AI 代理的技术架构、功能特性、设计理念进行全面对比。Codex 是 OpenAI 打造的专业编程代理，已被超过一百万开发者使用；pi-coding-agent 则是来自 pi-mono 项目的开源编程代理解决方案。两者的设计思路和技术选型存在显著差异，本报告旨在揭示这些差异，并为开发者选择合适的工具提供参考。

---

## 1. 技术架构与语言选型

### 1.1 编程语言

**Codex** 选择 **Rust** 作为核心开发语言，这一决策背后有深层次的考量。Codex 负责人 Tibo Sottiaux 在访谈中解释了三大原因：

其一为性能。团队希望代理能够在海量规模上运行，每毫秒都很重要。在本地沙盒环境中运行也需要高性能。Rust 正是以其执行效率著称。

其二为正确性。团队希望选择一种能够通过强类型和内存管理帮助消除一类错误的语言。Rust 的所有权系统和借用检查器能够在编译期捕获大量潜在错误。

其三为工程文化和质量。语言选择会影响团队对工程标准的设定。团队认为核心代理实现必须极其高质量，因此选择了 Rust。

此外，依赖管理也是一个实际考量。选择 TypeScript 意味着使用 npm 包管理器，而使用 npm 往往意味着构建在可能未被充分理解的包之上。Rust 依赖极少，团队可以彻底审查每一个依赖。Codex 还计划将代理运行在各种环境中，不仅是笔记本电脑和数据中心，甚至可能是嵌入式系统，Rust 从性能角度看比 TypeScript 或 Go 更容易实现这一目标。

**pi-coding-agent** 则选择 **TypeScript** 作为开发语言，这是 pi-mono 项目的整体技术栈。TypeScript 是 “on distribution” 类型的选择，充分发挥底层模型的强项。作为 JavaScript 的超集，TypeScript 提供了类型系统，同时保持了与 JavaScript 生态的完全兼容性。这种选择在开发效率和类型安全之间取得了平衡。

### 1.2 核心架构模式

**Codex** 的核心是一个状态机（state machine），代理循环（agent loop）是 Codex CLI 的核心逻辑。循环协调用户、模型和工具之间的交互。这种架构的优势在于状态清晰、易于调试和测试。

**pi-coding-agent** 采用 **事件驱动架构**，通过 EventBus 和 ExtensionRunner 实现组件间的松耦合通信。SessionManager 管理会话状态，Compaction 模块处理上下文压缩，Extensions 系统提供可扩展性。这种架构的优势在于灵活性和可插拔性。

### 1.3 源码结构

从代码组织来看，Codex CLI 是完全开源的（GitHub），核心代理和 CLI 都采用 Rust 编写。pi-coding-agent 的核心代码位于 packages/coding-agent/src 目录下，采用 TypeScript 实现，包含以下核心模块：

- agent-session.ts：会话生命周期管理
- session-manager.ts：会话持久化（JSONL 格式）
- compaction/：上下文压缩
- extensions/：扩展系统
- tools/：内置工具实现

---

## 2. Agent Loop 机制对比

### 2.1 Codex 的 Agent Loop

根据文章描述，Codex 的工作流程如下：

**第一步：提示组装（Prompt Assembly）**。代理获取用户输入，准备传递给模型的提示。除了用户输入外，提示还包含系统指令（编码标准、规则）、可用工具列表（包括 MCP 服务器）、实际输入（文本、图像、文件、AGENTS.md 内容、本地环境信息）。

**第二步：推理（Inference）**。提示被转换为 并馈 token送给模型，模型流式返回输出事件：推理步骤、工具调用或响应。

**第三步：响应处理**。将响应流式传输给用户（显示在终端上）。如果模型决定使用工具，发起工具调用（如读取文件、运行 bash 命令、写代码）。如果命令失败，错误信息返回给模型，模型尝试诊断问题，可能决定重试。

**第四步：工具响应（可选）**。如果调用了工具，将响应返回给模型。重复第三和第四步，直到不再需要更多工具调用。

**第五步：助手消息**。面向用户的“最终消息”，关闭循环的一步。然后循环随着新的用户消息再次开始。

### 2.2 pi-coding-agent 的 Agent Loop

pi-coding-agent 的代理循环体现在 AgentSession 类中，其核心流程如下：

**第一步：输入处理**。在 prompt() 方法中，首先处理扩展命令（以 / 开头的命令）。然后触发 input 事件，允许扩展拦截或转换输入。

**第二步：提示扩展**。展开技能命令（/skill:name）和提示模板（/template）。这是 pi-coding-agent 特有的机制，允许通过 Markdown 文件定义可复用的技能。

**第三步：消息构建**。构建消息数组，包括用户消息、待处理消息（steer/followUp）、扩展的 before_agent_start 事件处理。

**第四步：Agent 调用**。调用 agent.prompt(messages)，触发推理过程。

**第五步：事件循环**。处理各种事件：message_start、tool_call、tool_execution_start/end、message_end 等。

**第六步：持久化**。通过 appendMessage() 保存消息，appendCustomEntry() 保存扩展数据。

**第七步：自动压缩检查**。agent_end 后检查是否需要压缩。

### 2.3 关键差异

| 特性 | Codex | pi-coding-agent |
|------|-------|-----------------|
| 提示组装 | 包含 MCP 服务器支持 | 包含 Skills 和 Prompt Templates |
| 错误处理 | 工具失败后模型重试 | 扩展可以拦截/修改工具调用和结果 |
| 输入拦截 | 无内置机制 | 通过 input 事件扩展拦截 |
| 流式行为 | steer 和 followUp | 类似，但通过 streamingBehavior 参数控制 |

---

## 3. 会话持久化机制

### 3.1 Codex 的压缩策略

Codex 使用一种重要的技术——压缩（Compaction）。随着对话变长，上下文窗口会填满。Codex 采用压缩策略：一旦对话超过一定 token 数，它调用特殊的 Responses API 端点，生成对话历史的小表示。这个更小的版本替换旧输入，避免了二次推理成本（quadratic inference costs）。

这种方法是自引用的：使用当前的 Codex 模型来压缩自己的对话历史。

### 3.2 pi-coding-agent 的会话存储

pi-coding-agent 使用 **JSONL 文件格式** 存储会话，每个会话是一个独立的 .jsonl 文件。会话数据结构是树状的，支持分支（fork）和导航（navigateTree）。

**会话条目类型**包括：

- session：会话头信息
- message：用户/助手消息
- tool_call：工具调用
- tool_result：工具结果
- compaction：压缩摘要
- branch_summary：分支摘要
- custom：扩展自定义数据
- label：标签

**持久化策略**是追加写入的（append-only），首次包含助手消息时会重写文件以确保一致性，后续只有新条目追加到文件末尾。

**上下文构建**通过 buildSessionContext() 函数实现，它遍历从叶子节点到根节点的路径，处理压缩摘要和分支摘要，生成用于 LLM 的消息列表。

### 3.3 压缩算法

pi-coding-agent 的压缩逻辑位于 compaction/compaction.ts 中：

**触发条件**：上下文超过阈值 token 数或收到 overflow 错误。

**压缩流程**：

1. **准备阶段（prepareCompaction）**：计算当前上下文 token 数，确定要保留的起始位置。

2. **摘要生成**：调用 LLM 生成压缩摘要。提示词包含：
   - 对话目标（Goal）
   - 约束与偏好（Constraints & Preferences）
   - 已完成工作（Done）
   - 进行中工作（In Progress）
   - 阻塞问题（Blocked）
   - 关键决策（Key Decisions）
   - 下一步（Next Steps）
   - 关键上下文（Critical Context）

3. **替换上下文**：将压缩摘要和保留的消息替换旧上下文。

**扩展压缩**：pi-coding-agent 支持自定义压缩逻辑，扩展可以提供自己的压缩结果。

### 3.4 关键差异

| 特性 | Codex | pi-coding-agent |
|------|-------|-----------------|
| 存储格式 | Responses API (云端) | JSONL 文件 (本地) |
| 会话结构 | 线性对话 | 树状结构，支持分支 |
| 压缩方式 | Responses API 端点 | LLM 生成摘要 |
| 压缩扩展 | 无 | 支持扩展自定义压缩 |
| 历史访问 | 线性 | 支持导航到任意历史节点 |

---

## 4. 工具系统对比

### 4.1 Codex 的工具

Codex 支持的工具类型包括：

- 文件读取和编辑
- Bash 命令执行
- Web 搜索（通过 MCP）
- 各种 MCP 服务器集成

Codex 还特别强调了 MCP（Model Context Protocol）服务器的支持，这是与外部工具和系统交互的标准方式。

### 4.2 pi-coding-agent 的内置工具

pi-coding-agent 提供以下内置工具：

| 工具 | 功能 | 可写 |
|------|------|------|
| read | 读取文件内容，支持文本和图片 | 否 |
| bash | 执行 shell 命令 | 是 |
| edit | 编辑文件内容（精确替换） | 是 |
| write | 写入新文件 | 是 |
| grep | 搜索文件内容 | 否 |
| find | 查找文件 | 否 |
| ls | 列出目录内容 | 否 |

**工具工厂模式**：所有工具都通过工厂函数创建，接受 cwd 参数支持不同工作目录，还可以通过 operations 选项自定义实现（如 SSH 远程执行）。

### 4.3 自定义工具开发

pi-coding-agent 的扩展系统允许注册自定义工具：

```typescript
pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "Description for LLM",
  parameters: mySchema,  // TypeBox schema
  execute: async (toolCallId, params, signal, onUpdate, ctx) => {
    // 实现逻辑
    return { content: [{ type: "text", text: "Result" }] };
  }
});
```

**工具拦截机制**：扩展可以拦截工具调用（tool_call 事件）和修改工具结果（tool_result 事件）。

### 4.4 关于指定特定模型

**问题**：自定义工具可以指定特定模型吗？

**答案**：不能直接指定。工具是独立于模型的，但可以通过以下方式间接实现：

1. **检查当前模型**：在 execute 函数中通过 ctx.session.model 获取当前模型信息，根据模型特性调整行为。

2. **参数指定**：通过工具参数指定目标模型。

3. **注册多个工具**：为不同模型注册不同工具，通过 setActiveTools 动态切换。

---

## 5. 扩展性与技能系统

### 5.1 Codex 的 Skills

Codex 使用 "Agent Skills" 扩展代理能力，这是与 Claude Code 的 Skills 几乎相同的概念。Codex 团队内部构建了 100+ 个 Skills 供选择和使用：

- **Security best-practices skill**：全面检查代码安全实践，生成缺失的补丁
- **"Yeet" skill**：自动创建 PR 标题、描述和草稿 PR
- **Datadog integration skill**：连接 Datadog，审查警报和问题，尝试生成修复

### 5.2 pi-coding-agent 的 Skills

pi-coding-agent 有类似的技能系统，通过 SKILL.md 文件定义：

```markdown
---
name: my-skill
description: A useful skill
---

# Skill Content

Your skill content here...
```

技能通过 /skill:name 命令调用，可以在提示中展开。技能可以包含 frontmatter 元数据（name, description）。

### 5.3 扩展系统

pi-coding-agent 的扩展系统比 Codex 更开放：

- **事件订阅**：扩展可以订阅各种事件（session_start, agent_start, tool_call, message_end 等）
- **工具注册**：注册自定义工具
- **命令注册**：注册 slash 命令
- **快捷键注册**：注册键盘快捷键
- **标志注册**：注册 CLI 标志
- **UI 组件**：可以添加自定义 UI 组件

### 5.4 关键差异

| 特性 | Codex | pi-coding-agent |
|------|-------|-----------------|
| 技能数量 | 100+ 内部 Skills | 通过 SKILL.md 定义 |
| MCP 支持 | 原生支持 | 无内置 MCP |
| 扩展系统 | Skills 机制 | 完整的扩展 API |
| 事件系统 | 无详细文档 | 丰富的事件订阅 |

---

## 6. AGENTS.md 支持

### 6.1 Codex 的 AGENTS.md

Codex 大量使用 AGENTS.md。这些文件存储在仓库内部，告诉代理如何导航代码库、运行哪些命令进行测试、如何遵循项目标准。这些有点像 README 文件，但专为 AI 代理编写。AGENTS.md 已成为代理领域的事实标准，唯一不使用它的大型代理是 Claude Code。

### 6.2 pi-coding-agent 的 AGENTS.md

pi-coding-agent 也支持 AGENTS.md（以及 CLAUDE.md 作为备选）。资源加载器会在以下位置查找：

- AGENTS.md
- CLAUDE.md

这些文件的内容会被加载到系统提示中，为代理提供项目特定的指导。

### 6.3 关键差异

Codex 认为 AGENTS.md 是必不可少的，而 Claude Code 不使用它。pi-coding-agent 选择支持 AGENTS.md，这是对行业实践的认可。

---

## 7. 安全模型

### 7.1 Codex 的沙盒

Codex 在**沙盒环境**中运行，默认限制网络访问和文件系统访问。Tibo 表示：

> “我们采用沙盒立场，虽然在一般采用方面对我们不利。但我们不希望默认推广可能不安全的东西。作为开发者，你可以随时进入配置禁用这些设置。”

这种默认设置的原因是 Codex 的许多用户不太技术化，团队不希望给他们可能产生意外后果的东西。

### 7.2 pi-coding-agent 的安全模型

pi-coding-agent **没有内置沙盒**。它假设在受信任的环境中运行，由用户控制文件系统和网络访问。

### 7.3 关键差异

| 特性 | Codex | pi-coding-agent |
|------|-------|-----------------|
| 默认沙盒 | 是 | 否 |
| 网络限制 | 是（默认） | 无 |
| 文件系统限制 | 是（默认） | 无 |
| 安全策略 | 保守 | 信任用户 |

---

## 8. 代码生成与自举

### 8.1 Codex 自我构建

超过 90% 的 Codex 应用代码是由 Codex 本身生成的，这与 Anthropic 报告的 Claude Code 数据大致一致。两个 AI 实验室都使用编码工具编写自己代码的元循环性。

典型场景：

- 一个工程师同时运行 4-8 个并行代理
- 代理可以执行功能实现、代码审查、安全审查、代码库理解、计划总结等任务
- Codex 工程师现在是“代理管理者”，不再只是写代码

### 8.2 实践

Codex 团队的其他工程实践包括：

- **分层代码审查**：AI 代码审查始终运行，训练了专用模型进行代码审查，优化信号而非噪音。大约十分之九的评论指出有效问题。
- **测试驱动代理**：代码库结构化使模型“必然成功”。有测试、清晰的模块边界、验证说明。当模型实现不正确时，测试失败，代理注意到并尝试修复。
- **夜间运行**：团队设置 Codex 夜间运行，被指示查找问题。每早工程师审查 Codex 识别的问题和等待审查的修复。
- **配对入职**：新成员被要求保持开放心态，观察有经验的工程师如何与 Codex 配对开发，然后在同一天交付任务到生产。

### 8.3 pi-coding-agent 的自举

pi-coding-agent 作为一个较新的项目，没有公开声称类似的自我构建比例。

---

## 9. 发布与分发

### 9.1 Codex 的发布节奏

- 内部：每天最多 3-4 次新版本
- 外部：每隔几天发布一次
- 渠道：包管理器、Homebrew、npm

### 9.2 pi-coding-agent 的发布

pi-coding-agent 作为 npm 包发布，集成在 pi-mono 仓库中。发布遵循语义化版本控制，所有包锁定同步版本。

---

## 10. 多代理与并行

### 10.1 Codex 的多代理

Codex 团队典型工程师运行 4-8 个并行代理，同时处理不同任务。Tibo 指出：

> “Codex 真正为多任务设计。有一种理解是大多数任务都会完成到完成。”

### 10.2 pi-coding-agent 的多代理

pi-coding-agent 的 examples/extensions/subagent 目录提供了子代理（Subagent）扩展示例，展示如何实现多代理架构。

---

## 11. 总结与建议

### 11.1 主要差异一览

| 维度 | Codex | pi-coding-agent |
|------|-------|-----------------|
| 语言 | Rust | TypeScript |
| 架构 | 状态机 | 事件驱动 |
| 存储 | 云端 Responses API | 本地 JSONL |
| 会话结构 | 线性 | 树状（支持分支） |
| 沙盒 | 默认启用 | 无 |
| MCP | 原生支持 | 无 |
| 扩展性 | Skills | 完整扩展 API |
| 发布频率 | 每天多次 | npm 包发布 |
| 自生成 | >90% | 未披露 |

### 11.2 选择建议

**选择 Codex 当**：

- 需要企业级支持
- 重视沙盒安全
- 需要 MCP 集成
- 偏好 Rust 生态系统
- 团队规模较大

**选择 pi-coding-agent 当**：

- 已有 TypeScript/Node.js 技术栈
- 需要本地会话持久化和分支
- 需要深度定制扩展
- 预算有限
- 偏好开源透明

### 11.3 各自优势

**Codex 的优势**：

- 性能优化（Rust）
- 沙盒安全默认
- MCP 生态
- 大规模部署经验

**pi-coding-agent 的优势**：

- 完整的事件驱动扩展系统
- 树状会话支持分支
- 本地化存储（数据自主）
- TypeScript 生态系统集成
- 开源透明

---

## 参考资料

- [How Codex is built - Gergely Orosz](https://newsletter.pragmaticengineer.com/p/how-codex-is-built)
- [pi-coding-agent 源码](file://d:\temp\pi-mono-agent\packages\coding-agent\src)
- [Unrolling the Codex Agent Loop - Michael Bolin](https://blog)
