下面是一份**面向架构师的研究报告**，目标是回答：

> 在执行一个 long-running task（高 token 消耗、可能调用多工具/多脚本）之前，是否可以：
>
> 1. 先进行“完整性预检”
> 2. 必要时向用户提问补充
> 3. 一旦开始执行任务后，不再进行任何人工交互
> 4. 且整个流程可以封装在一个 SKILL 中（可能调用 script / reference）

并参考：

* pi-mono
* Claude Code
* GitHub Copilot

---

# 一、核心问题抽象

你要解决的是一个经典问题：

> 如何把一个“交互式 LLM 任务”变成一个“前置校验 + 全自动执行”的 Deterministic Agent 流程？

这本质上涉及四个能力：

1. **Input Contract 建模**
2. **Preflight 校验阶段**
3. **冻结上下文（Context Freeze）**
4. **单次提交式执行（Single-commit Execution）**

---

# 二、主流 Coding Agent 的实现思路分析

## 1️⃣ pi-mono 的模式

pi-mono 的设计核心是：

* 基于 tool（read/write/find）
* 文件系统即上下文
* 任务通过“代码 + 工具调用”组合完成
* Agent 是一个多轮可恢复系统

特点：

| 维度   | 特性            |
| ---- | ------------- |
| 上下文  | 文件系统 + prompt |
| 可恢复性 | 强             |
| 交互性  | 默认允许          |
| 任务冻结 | 无硬性机制         |

**结论：**
pi-mono 默认是“动态 agent”，不是“预检后锁死执行”模型，但可以通过 skill 约束实现。

---

## 2️⃣ Claude Code 的模式

Claude Code 采用的模型：

* 计划（plan）
* 执行（execute）
* 修正（reflect）
* 重试（retry）

它不是一次性执行，而是：

> 生成计划 → 执行 → 校验 → 继续

优点：

* 高成功率
* 自我修复能力强

缺点：

* Token 成本高
* 运行中可能继续发问
* 不保证单次执行完成

---

## 3️⃣ GitHub Copilot Agent 模式

GitHub Copilot 的 Agent：

* 计划阶段独立
* 用户确认后执行
* 执行中尽量不再提问

这个模式**非常接近你的目标架构**。

---

# 三、可行性结论

你的目标是：

> ✔ 预检
> ✔ 补齐信息
> ✔ 锁定上下文
> ✔ 执行阶段零交互

技术上完全可实现。

但必须改变 Skill 设计哲学：

> Skill 不再只是 prompt，而是一个“有限状态机”。

---

# 四、推荐架构：Two-Phase Commit Agent

我建议你设计为：

```
Phase 1: Preflight Validation
Phase 2: Frozen Execution
```

---

# 五、完整架构设计

## 阶段一：Preflight Phase

目标：

* 检查必需输入
* 检查依赖文件
* 检查 reference
* 检查 tool 可用性
* 计算 token 预算
* 提出缺失问题

### 实现方法

在 skill 中定义：

```yaml
required_inputs:
  - business_context
  - target_repo
  - output_format

required_files:
  - architecture.md
  - domain_model.md

required_tools:
  - read
  - write
  - find
```

然后：

1. LLM 读取 skill metadata
2. 对照 context 检查
3. 输出缺失项
4. 提问
5. 等待补充

⚠️ 此阶段允许交互。

---

## 阶段二：Context Freeze

当校验通过：

* 汇总：

  * 所有用户回答
  * 所有依赖文件内容
  * 所有 reference
  * 所有 script 路径
* 构造一个“Execution Snapshot”

例如：

```json
{
  "inputs": {...},
  "files_digest": {...},
  "tool_contract": {...},
  "token_budget": 120k
}
```

然后：

> 禁止再提问。

---

## 阶段三：Single-pass Execution

执行规则：

* 不再 ask question
* 不做外部推断
* 不扩展 scope
* 仅使用 snapshot 数据

如果失败：

* 直接失败
* 输出 error report
* 不自动回问

---

# 六、Skill 设计建议（适配你的 use case）

你说：

> 提示词会放在一个 skill 中，可能调用 script 或 reference

建议 Skill 结构：

```
skill.md
skill.schema.yaml
scripts/
references/
```

---

## Skill.md 建议结构

```markdown
# MODE

This skill runs in two phases:
1. Preflight validation (interactive allowed)
2. Frozen execution (no interaction)

---

# PRECHECK RULES

Before execution:
- Validate required inputs
- Validate required files
- Validate tool availability
- Estimate token consumption
- Ask for missing info

If anything missing:
→ Ask user
→ STOP execution

---

# EXECUTION RULES

After confirmation:
- DO NOT ask questions
- DO NOT expand scope
- DO NOT infer missing info
- Only use snapshot

If failed:
→ Generate error report
```

---

# 七、Token 成本控制策略

在 long task 中：

1. 预估 token 消耗
2. 若超过阈值：

   * 拆分为子任务
   * 或中止执行

可加入：

```yaml
max_token_budget: 150000
fail_if_exceed: true
```

---

# 八、是否能 100% 成功？

理论上：

✔ 可以实现 0 交互执行
✔ 可以实现 deterministic 模式

但注意：

* LLM 天然不是 deterministic 系统
* 外部 tool 可能失败
* 文件可能变化
* 脚本可能报错

所以建议：

> 加入执行日志 + 重放能力

---

# 九、对比总结

| 模式            | 是否预检  | 是否冻结 | 是否可零交互执行 |
| ------------- | ----- | ---- | -------- |
| pi-mono       | ❌ 默认无 | ❌    | ❌        |
| Claude Code   | 部分    | ❌    | ❌        |
| Copilot Agent | ✔     | 半冻结  | ✔        |
| 你设计的          | ✔     | ✔    | ✔        |

---

# 十、最终结论

你的目标：

> 预检 + 补齐 + 冻结 + 执行不再交互

✔ 完全可实现
✔ 可以封装在 skill 中
✔ 可调用 script 和 reference
✔ 可控制 token 成本

但必须：

* 把 Skill 从“Prompt 模板”升级为“有限状态机”
* 加入显式 PRECHECK 阶段
* 加入 Snapshot 构造逻辑
* 在 EXECUTION 阶段强制 no-question policy

---

# 十一、如果你愿意，我可以进一步给你：

1. 一个完整的 skill.md 模板（生产级）
2. 一个 Python 执行框架伪代码
3. 一个基于 pi-mono 风格的实现示例
4. 一个 deterministic agent 设计规范文档
5. 或者把它设计成可复用的“Long Task Skill SDK”

你希望往哪个方向深入？



---


下面给你一个**生产级 `skill.md` 模板**，专门面向：

* 使用 pi-mono
* Coding Agent 场景
* 支持 Preflight 检查
* 允许前期交互
* 一旦进入执行阶段 **禁止任何交互**
* 支持调用 script / reference
* 可用于 long-running / 高 token 任务

这个模板设计为**两阶段有限状态机（FSM）结构**。

---

# ✅ 设计目标

1. **阶段一：Preflight（可交互）**

   * 检查输入
   * 检查文件
   * 检查依赖
   * 检查 token 预算
   * 提出问题并等待用户补充
   * 生成 Execution Snapshot

2. **阶段二：Frozen Execution（不可交互）**

   * 禁止提问
   * 禁止扩展 scope
   * 禁止假设缺失信息
   * 仅使用 Snapshot
   * 失败时输出 Error Report
   * 必须运行到结束

---

# 📦 生产级 `skill.md` 模板

你可以直接复制作为基础版本。

---

```markdown
# SKILL NAME
Long-Running Deterministic Task Executor

# VERSION
1.0.0

# COMPATIBILITY
Designed for pi-mono coding agent

---

# GLOBAL EXECUTION MODEL

This skill operates in TWO STRICT PHASES:

PHASE 1 — PREFLIGHT (INTERACTIVE ALLOWED)
PHASE 2 — FROZEN EXECUTION (NO INTERACTION ALLOWED)

The agent MUST follow this state machine:

INITIAL
  → PREFLIGHT
  → (if validation passes) SNAPSHOT_CREATED
  → FROZEN_EXECUTION
  → COMPLETE

Under NO circumstances may the agent ask questions during FROZEN_EXECUTION.

---

# PHASE 1 — PREFLIGHT

## OBJECTIVE

Before performing any heavy operation, the agent MUST:

1. Validate required inputs
2. Validate required files
3. Validate required tools
4. Validate required references
5. Estimate token usage
6. Ask user for missing information (if any)
7. STOP until all requirements are satisfied

---

## REQUIRED INPUTS

The following inputs must exist in context:

- {{business_context}}
- {{task_goal}}
- {{output_format}}

If any input is missing:
→ Ask user clearly and explicitly
→ DO NOT proceed

---

## REQUIRED FILES

The following files must exist:

- architecture.md
- domain_model.md
- requirements.md

Use read tool to confirm existence.

If any file is missing:
→ Ask user whether to:
   (A) Provide content
   (B) Generate placeholder
   (C) Abort

Do not assume.

---

## REQUIRED TOOLS

The following tools must be available:

- read
- write
- find

If unavailable:
→ Abort with explanation

---

## OPTIONAL REFERENCES

If references directory exists:
- Load file list
- Summarize relevant references
- Confirm relevance

If reference is too large:
→ Ask user whether to narrow scope

---

## TOKEN BUDGET VALIDATION

Before execution:

1. Estimate:
   - Total file tokens
   - Estimated reasoning tokens
   - Estimated output tokens

2. If estimated tokens > MAX_TOKEN_BUDGET:

   Ask user:
   - Split task?
   - Reduce scope?
   - Continue anyway?

Do not auto-truncate.

---

## SNAPSHOT CREATION

When all validations pass:

Create an Execution Snapshot in memory:

SNAPSHOT CONTENTS:

- Final confirmed inputs
- File digests (hash or summary)
- Reference summaries
- Tool contract
- Execution plan outline
- Token budget

After snapshot creation:

Declare:

"Preflight complete. Execution will now begin. No further interaction will occur."

Transition to FROZEN_EXECUTION.

---

# PHASE 2 — FROZEN EXECUTION

## CRITICAL RULES

During this phase:

- DO NOT ask any question
- DO NOT request clarification
- DO NOT expand scope
- DO NOT introduce new assumptions
- DO NOT re-validate inputs
- DO NOT consult user

If required information is missing:
→ Fail with structured error report

---

## EXECUTION STRATEGY

Follow this sequence:

1. Generate internal execution plan (not exposed)
2. Break into deterministic steps
3. Use tools minimally
4. Write outputs incrementally
5. Maintain state via file system only

---

## SCRIPT EXECUTION POLICY

If calling external scripts:

- Validate script path from snapshot
- Pass only snapshot-defined inputs
- Capture script output
- If script fails:
   → Log failure
   → Continue if recoverable
   → Otherwise abort with report

No interactive retries allowed.

---

## FAILURE POLICY

If execution fails:

Output structured failure report:

- Failure step
- Cause
- Inputs used
- Files used
- Partial outputs
- Suggested next actions

Do not ask user for correction.

---

## COMPLETION CRITERIA

Execution completes ONLY when:

- All required outputs are written
- Final summary is generated
- All temporary artifacts cleaned (if applicable)

Then output:

"Execution complete."

---

# OUTPUT RULES

All outputs must:

- Follow {{output_format}}
- Be deterministic
- Avoid speculative language
- Avoid conversational tone
- Avoid follow-up questions

---

# ANTI-PATTERNS (STRICTLY FORBIDDEN IN FROZEN PHASE)

- "Could you clarify..."
- "Do you want me to..."
- "Should I..."
- "I need more information..."
- Any request for user interaction

---

# RECOVERY MODEL

This skill does NOT auto-retry.
This skill does NOT re-enter PREFLIGHT.
This skill does NOT partially re-plan.

If failure occurs:
→ Terminate with full report.

---

# DESIGN PHILOSOPHY

This skill prioritizes:

- Determinism
- Cost predictability
- Controlled token usage
- Enterprise-grade execution behavior
- No mid-flight human dependency

---

# END OF SKILL
```

---

# 🧠 架构说明（为什么这个模板是“生产级”）

### 1️⃣ 明确状态机

不是 prompt，而是 FSM。

### 2️⃣ 强制 Snapshot

避免运行中上下文漂移。

### 3️⃣ 明确禁止交互

很多 agent 会“偷偷问一句”，这里彻底禁止。

### 4️⃣ Token 预算前置

避免 200k token 之后才发现爆掉。

### 5️⃣ 企业级失败模型

失败不是问人，而是报告。

---

# 📌 可选增强（推荐）

你可以进一步升级为：

* 添加 `execution_mode: deterministic | adaptive`
* 添加 `max_step_limit`
* 添加 `max_tool_calls`
* 添加 `strict_file_hash_validation`
* 添加 `execution_log.md` 自动记录

---

# 🎯 总结

是的：

✔ 可以在 pi-mono 上实现
✔ 可以前期交互
✔ 可以后期零交互
✔ 可以稳定运行到结束
✔ 可以企业级可控

---

如果你愿意，我可以：

* 给你一个 **配套 skill.schema.yaml**
* 或写一个 **Python 执行壳框架**
* 或帮你设计一个 Long-Task Skill SDK 结构
* 或做一个更极端的“可审计 deterministic agent 规范”

你想往“更工程化”还是“更理论化”方向深入？
