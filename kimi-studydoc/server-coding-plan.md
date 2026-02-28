好的。

下面是一个**紧密结合 `pi-mono` 与 `pi-coding-agent` 实现机制的生产级项目设计计划**。
目标是：

> ✅ 在执行 long-time coding task 前完成依赖收敛
> ✅ 执行阶段完全无交互
> ✅ 支持多并发 session
> ✅ 支持断点恢复
> ✅ 尽可能通过 extension 机制保证行为
> ✅ 使用 skill 作为能力单元

---

# 一、项目目标定义

## 1️⃣ 你要解决的核心问题

在 `pi-coding-agent` 执行一个可能消耗大量 tokens 的任务时：

* 前置阶段：

  * 检查 prompt + skill 是否满足依赖
  * 如果缺失 → 只在此阶段允许交互
* 冻结阶段：

  * 固化所有输入、文件、skill、script、引用
* 执行阶段：

  * 绝对禁止用户交互
  * 即使模型尝试 ask_question 也要被拦截
* 长时间运行：

  * 支持 crash 恢复
  * 支持 session 并发

---

# 二、基于 pi-mono 的关键实现机制

我们必须围绕以下组件设计：

## 1️⃣ pi-mono 核心结构

`pi-mono` 是一个：

* agent runtime
* tool-call 驱动
* extension 生命周期拦截器
* skill 调用能力单元
* 支持 sub-agent

关键机制：

| 组件              | 作用            |
| --------------- | ------------- |
| Agent Runtime   | 运行循环          |
| Tool Invocation | LLM 驱动行为      |
| Extension       | 生命周期 hook     |
| Skill           | Prompt + 工具组合 |
| Sub-agent       | 子任务封装         |
| Message Graph   | 状态管理          |

---

## 2️⃣ pi-coding-agent 特性

`@badlogic/pi-coding-agent`：

* 基于 pi-mono runtime
* 有 coding-specific 工具：

  * file read/write
  * shell
  * apply patch
  * search
* 可以注册 extension
* 支持 subagent example（官方示例）

---

# 三、架构总览（生产级）

```
Client
   ↓
Server App (你写)
   ↓
Session Manager
   ↓
Preflight Extension
   ↓
Snapshot Freeze
   ↓
Execution Agent (No-Interaction Mode)
```

---

# 四、分阶段架构设计

---

# 阶段 1：Session 管理层

## 设计目标

* 多并发
* 可恢复
* 每个 session 独立 runtime

## 数据结构

```ts
Session {
  id
  state
  contract
  snapshot
  messageHistory
  createdAt
  updatedAt
}
```

存储：

* 生产：Postgres / Redis
* 简版：JSON 文件

状态机：

```
INIT
↓
CONTRACT_SYNTHESIS
↓
PREFLIGHT
↓
FROZEN
↓
EXECUTING
↓
COMPLETE / FAILED
```

---

# 阶段 2：Preflight Contract Synthesis

这是核心。

## 为什么不能直接把 prompt 丢给 agent？

因为：

* coding-agent 会进入 run loop
* 一旦进入 tool-call 阶段
* 就已经开始消耗 token
* 也可能 ask_question

所以：

> Preflight 不能使用完整 agent runtime

---

## 推荐实现：轻量级 LLM 合同生成器

独立调用 LLM（不启动 agent runtime）：

输入：

* userPrompt
* skill.md 内容
* skill 调用的 script/ref

输出：

```json
{
  "required_inputs": [],
  "required_files": [],
  "required_tools": [],
  "required_scripts": [],
  "missing_information": []
}
```

然后：

* 如果 missing_information 非空 → 返回给用户
* 否则进入冻结阶段

---

# 阶段 3：冻结（Snapshot Freeze）

冻结包括：

* prompt
* skill 内容
* 所有引用文件 hash
* script 版本
* 当前 repo commit
* tool whitelist

构建：

```ts
Snapshot {
  contract
  prompt
  skillText
  fileDigests
  toolWhitelist
  createdAt
}
```

然后将 snapshot 作为 execution 唯一输入。

---

# 阶段 4：Execution 阶段（无交互）

这里必须用 extension 机制保证。

---

# 五、如何用 Extension 强制“无交互”

在 pi-mono 中：

Extension 可以 hook：

* onToolCall
* onBeforeLLM
* onAfterLLM
* onMessage
* onAgentLoop

---

## 实现 NoInteractionExtension

核心逻辑：

```ts
class NoInteractionExtension {
  onToolCall(toolCall) {
    if (toolCall.name === "ask_user") {
      throw new Error("Interaction forbidden in EXECUTION mode")
    }
  }
}
```

同时：

* 禁止 ask_question tool
* 禁止 subagent 询问
* 禁止动态 prompt injection

---

## 再加一层保护：Tool 白名单

在 Execution Agent 初始化时：

```ts
new CodingAgent({
  tools: [
    fileRead,
    fileWrite,
    shell,
    applyPatch
  ]
})
```

不注册：

* ask_user
* clarification tool

---

# 六、是否可以通过 extension 完全保证？

答案：

> 可以逻辑保证
> 不能 token 级物理保证

因为：

* LLM 仍可能输出自然语言问句
* 但只要 tool 层禁止 ask_user
* 就不会真正产生交互

---

# 七、长时间任务断点恢复设计

关键：

* 不依赖 agent 内部 memory
* 每轮 tool call 后持久化 message history

实现：

在 extension：

```ts
onAfterToolCall(ctx) {
   saveMessageGraph(ctx.agent.messages)
}
```

恢复时：

```ts
agent.loadMessages(history)
agent.resume()
```

如果 pi-coding-agent 不支持 resume：

* 你必须 fork runtime
* 或使用 subagent chunk 执行

---

# 八、Sub-agent 方案（更稳定）

官方示例：

`examples/extensions/subagent`

思路：

* 主 agent 只做 orchestration
* 长任务交给 sub-agent
* sub-agent 每个步骤是可控 chunk

这样可以：

* 每个子任务独立 snapshot
* 容易恢复
* 更稳定

---

# 九、推荐最终架构（结合所有）

```
Server
  ↓
Session FSM
  ↓
Preflight LLM
  ↓
Freeze Snapshot
  ↓
CodingAgent(
      extensions: [
          NoInteractionExtension,
          PersistenceExtension
      ],
      tools: restrictedTools
  )
  ↓
Optional Subagent Execution
```

---

# 十、Skill 设计原则（必须配合）

skill.md 必须：

* 明确 required inputs
* 明确 required files
* 明确 required tools
* 不允许动态依赖

否则 preflight 无法确定依赖闭包。

---

# 十一、与 pi-mono 强绑定点

| 设计项       | 对应 pi-mono 机制                |
| --------- | ---------------------------- |
| 无交互保证     | Extension onToolCall         |
| 多 session | 独立 runtime 实例                |
| 恢复        | message graph 持久化            |
| 子任务       | Sub-agent example            |
| 工具限制      | Agent tool registration      |
| 冻结输入      | 不允许 runtime 修改 system prompt |

---

# 十二、你应该让 coding agent 实现的模块列表

让其他 coding agent 实现：

### 1️⃣ SessionManager

* createSession
* updateSession
* loadSession

### 2️⃣ ContractSynthesizer

* 调 LLM
* 输出严格 JSON

### 3️⃣ SnapshotBuilder

* hash 文件
* 固化 skill

### 4️⃣ NoInteractionExtension

* 拦截 ask_user
* 拦截 clarification tool

### 5️⃣ PersistenceExtension

* 每次 tool call 后保存 message graph

### 6️⃣ ExecutionRunner

* 创建 coding-agent
* 加载 extensions
* 加载 snapshot
* 运行

---

# 十三、风险分析

| 风险           | 对策               |
| ------------ | ---------------- |
| LLM 仍然输出问句   | tool 层禁止         |
| 技术债来自 resume | 用 subagent chunk |
| 依赖分析不准确      | skill 结构化        |
| 过多 token     | 强制最大 step        |

---

# 十四、结论

你完全可以：

> 通过 extension 机制 + 工具白名单 + 预检查合同 + snapshot freeze
> 在 pi-mono / pi-coding-agent 体系内实现：

* 前置交互
* 执行阶段 0 交互
* 多 session
* 可恢复
* 可扩展

并且：

> 不需要改动 pi-mono 核心代码
> 只需要写 extension + 外部 server 管理

---
下面是一份**专门写给 Coding Agent 的实施任务说明书（Implementation Brief）**。
目标是：**强约束实现方向，避免跑偏，紧密贴合 `pi-mono` 与 `pi-coding-agent` 的真实机制。**

---

# 📘 实施任务说明书

## 项目名称

**Deterministic Long-Running Coding Agent Framework (DLCAF)**

---

# 🎯 一、项目目标（必须满足）

本项目基于：

* `pi-mono`
* `@badlogic/pi-coding-agent`

实现一个具备以下能力的系统：

### 必须满足：

1. 执行 long-time coding task 前进行依赖预检查
2. 预检查阶段允许与用户交互
3. 执行阶段绝对禁止任何用户交互
4. 支持多并发 session
5. 支持长时间任务断点恢复
6. 不修改 pi-mono 核心源码
7. 所有控制通过 extension + 外部 orchestration 完成

---

# 🧱 二、必须遵守的架构原则

Coding Agent 必须遵守以下架构边界：

## 1️⃣ 不允许：

* 修改 pi-mono runtime 内部源码
* 修改 pi-coding-agent 核心逻辑
* Hack agent loop
* Patch message graph 内部实现

## 2️⃣ 必须通过：

* Extension 生命周期 hook
* Tool 白名单控制
* 外部 Session 管理
* Snapshot 冻结
* 明确 FSM 状态机

---

# 🏗 三、系统总体架构

```
Server Layer
   ↓
Session FSM
   ↓
Preflight Contract Synthesizer (LLM)
   ↓
Snapshot Builder
   ↓
CodingAgent Runtime
      + NoInteractionExtension
      + PersistenceExtension
```

---

# 🧠 四、核心模块划分

Coding Agent 必须实现以下模块：

---

## 模块 1：SessionManager

### 责任：

* 创建 session
* 管理状态机
* 持久化状态
* 支持恢复

### 状态机：

```
INIT
↓
CONTRACT_SYNTHESIS
↓
PREFLIGHT
↓
FROZEN
↓
EXECUTING
↓
COMPLETE / FAILED
```

### 数据结构：

```ts
interface Session {
  id: string
  state: ExecutionState
  userPrompt: string
  skillText: string
  contract?: ExecutionContract
  snapshot?: Snapshot
  messageHistory?: AgentMessage[]
  createdAt: number
  updatedAt: number
}
```

### 存储：

* 第一版本可使用 JSON 文件
* 需抽象存储接口以支持未来 Redis / DB

---

## 模块 2：ContractSynthesizer

### 目标：

在不启动 CodingAgent runtime 的情况下完成依赖分析。

### 输入：

* userPrompt
* skill.md
* skill 引用的 scripts

### 输出：

```json
{
  "required_inputs": [],
  "required_files": [],
  "required_tools": [],
  "required_scripts": [],
  "missing_information": []
}
```

### 约束：

* 必须调用独立 LLM
* 不允许使用 coding-agent
* 输出必须是严格 JSON

### 若 missing_information 非空：

* 停止流程
* 返回给用户
* 等待用户补充

---

## 模块 3：SnapshotBuilder

### 目标：

构建 execution 的不可变输入闭包。

### 必须冻结：

* userPrompt
* skillText
* contract
* 文件 SHA256
* 工具白名单
* repo 当前 commit hash

### 输出结构：

```ts
interface Snapshot {
  prompt: string
  skillText: string
  contract: ExecutionContract
  fileDigests: Record<string,string>
  toolWhitelist: string[]
  createdAt: number
}
```

---

## 模块 4：NoInteractionExtension

### 目标：

执行阶段绝对禁止用户交互。

### 必须实现 hook：

* onToolCall
* onBeforeLLM

### 逻辑：

```ts
if (toolCall.name === "ask_user") {
   throw new Error("Interaction forbidden")
}
```

必须禁止：

* ask_user
* clarification
* interactive subagent

---

## 模块 5：PersistenceExtension

### 目标：

实现断点恢复。

### 必须在：

* onAfterToolCall
* onAfterLLM

时保存：

* 完整 message graph
* 当前 step index

### 恢复流程：

* 从 storage 读取 messageHistory
* 重建 agent
* 重新注入 messageHistory
* 继续运行

---

## 模块 6：ExecutionRunner

### 目标：

构建 CodingAgent 实例并运行。

### 初始化必须：

```ts
new CodingAgent({
  tools: restrictedTools,
  extensions: [
     new NoInteractionExtension(),
     new PersistenceExtension()
  ],
  systemPrompt: "Execution Mode: No interaction allowed."
})
```

### 不允许注册：

* ask_user tool
* 任何交互型 tool

---

# 🔐 五、无交互强约束机制

Coding Agent 必须实现三层保护：

| 层级            | 方法            |
| ------------- | ------------- |
| Tool层         | 不注册 ask_user  |
| Extension层    | 拦截任何 ask_user |
| SystemPrompt层 | 明确禁止交互        |

---

# 🧩 六、Sub-agent 使用规范

如果使用 sub-agent：

必须：

* 子 agent 同样注册 NoInteractionExtension
* 不允许子 agent 覆盖 tool 白名单
* 不允许子 agent 发起 ask_user

---

# 💾 七、断点恢复设计要求

必须支持：

* 任意时刻 crash
* 重新启动 server
* session 可继续

恢复逻辑：

```
if state == EXECUTING:
   load snapshot
   load messageHistory
   rehydrate agent
   resume loop
```

若 runtime 不支持 resume：

* 必须实现 step-chunk 执行
* 每个 chunk 单独运行

---

# 📏 八、Skill 编写规范（强约束）

Skill 文件必须：

* 显式声明 required inputs
* 显式声明 required tools
* 不允许动态依赖

否则 preflight 无法可靠运行。

---

# 🚨 九、Coding Agent 常见跑偏点（必须避免）

1. 直接把 prompt 丢给 coding-agent 运行
2. 在 execution 阶段允许 ask_user
3. 不做 snapshot freeze
4. 把 preflight 逻辑写进 extension
5. 修改 pi-mono 内部源码
6. 不做持久化 message graph

---

# 🧪 十、验收标准

必须通过以下测试：

### Test 1：缺失输入

* Preflight 阶段返回 missing_information
* 不进入 EXECUTING

### Test 2：执行阶段问问题

* agent 试图 ask_user
* 被 extension 阻止
* session 标记 FAILED

### Test 3：Crash 恢复

* 执行过程中 kill server
* 重启
* session 继续执行

### Test 4：多 session 并发

* 同时运行 5 个 session
* 不互相干扰

---

# 🏁 十一、最终交付物

Coding Agent 必须交付：

* src/

  * SessionManager.ts
  * ContractSynthesizer.ts
  * SnapshotBuilder.ts
  * NoInteractionExtension.ts
  * PersistenceExtension.ts
  * ExecutionRunner.ts
  * server.ts
* 单元测试
* README（说明如何运行）

---

# 📌 十二、最终目标总结

该系统应实现：

> 先收敛依赖 → 冻结环境 → 再 deterministic 执行 → 无交互 → 可恢复

并且：

* 完全基于 pi-mono extension 机制
* 不修改核心 runtime
* 可生产部署

---
