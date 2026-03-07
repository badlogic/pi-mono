# 研究文档：OpenClaw 中的 Tool Orchestration — 模型驱动还是框架驱动？

## 1. 概述

Tool Orchestration（工具编排）决定了 Agent 如何选择和执行工具。通过对 OpenClaw `src/agents/pi-tools.ts` 和 `src/agents/pi-embedded-runner/run.ts` 的分析，我们可以揭示其背后的设计哲学。

## 2. 核心课题研究

### 2.1 Tool 调用是否完全依赖 LLM？
- **是的，决策层完全依赖 LLM**：
    - OpenClaw 本身不包含任何预定义的、确定性的状态机来规定“先运行 A 工具，再运行 B 工具”。
    - 当 LLM 生成一个 `tool_use` 消息时，OpenClaw 的 Loop 会捕获该请求并执行对应的工具。
    - 工具的选择、参数的构造完全由模型的推理能力驱动。

### 2.2 框架是否有 Override 能力？
- **具备强大的“前置/后置”干预能力（框架驱动的约束）**：
    - **Policy Pipeline (策略流水线)**：通过 `applyToolPolicyPipeline`，框架可以在工具暴露给模型之前进行过滤。
    - **Hook 机制**：支持 `before_tool_call` 钩子。框架可以在模型决定调用工具后、工具真正执行前进行干预（如：Loop Detection、安全审计、参数注入）。
    - **沙箱隔离**：框架强制将 `read/write/exec` 等工具路由到 Docker 沙箱中。这意味着即使模型想访问宿主机，框架也会通过路径重映射和环境隔离将其强行纠正。

### 2.3 是否支持 Deterministic Workflow（确定性工作流）？
- **原生不支持（与 AutoGen 不同）**：
    - 与 AutoGen 这种可以定义 `Graph` 或 `Sequence` 的框架不同，OpenClaw 的工作流是**高度随机响应式**的。
    - **变相支持**：通过 `Skills` (SKILL.md) 为模型提供一套“确定性的人类指令”。虽然执行仍由模型驱动，但 Skill 文件的存在相当于一份“执行手册”，将随机性限制在手册框架内。

## 3. 对比分析

| 维度 | OpenClaw | LangChain (AgentExecutor) | Microsoft AutoGen |
| :--- | :--- | :--- | :--- |
| **编排核心** | **模型驱动 (Model-Driven)** | **框架驱动 (Logic-Driven)** | **协议驱动 (Protocol-Driven)** |
| **执行逻辑** | LLM 决定下一个工具，Loop 无脑执行。 | 预定义的推理链（如 ReAct），框架严格控制循环次数。 | 基于消息传递，可定义固定的交互拓扑图。 |
| **可控性** | 弱（依赖 Prompt 和 Skill）。 | 中（支持固定步骤的 Chains）。 | 强（支持确定性的状态机转换）。 |
| **灵活性** | 极高（能处理非预期的复杂路径）。 | 低（步骤固定后难以应对异常）。 | 高（支持多 Agent 复杂协作）。 |

## 4. 总结

OpenClaw 的工具编排本质上是**模型驱动 (Model-Driven)** 的，它将决策权交给了 LLM，而框架（OpenClaw）充当了**执行器和监护人 (Executor & Guardian)**。

- **模型负责“想”**：决定用什么工具，给什么参数。
- **框架负责“做”与“防”**：确保工具在沙箱中运行、确保权限合规、通过 Hook 拦截循环调用、并通过 Compaction 算法维护上下文。

这种设计使得 OpenClaw 能够解决那些无法被预先定义为流程图的、极其复杂的软件工程问题，但也对模型的推理质量和 Prompt 的严谨性提出了极高要求。

---
*文档生成日期：2026-02-18*
*研究范围：src/agents/pi-tools.ts, src/agents/tool-policy-pipeline.ts*
