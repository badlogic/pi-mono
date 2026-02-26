# 研究文档：OpenClaw 的 Agents 协同执行架构设计与可扩展性

## 1. 多 Agent 协调执行机制

OpenClaw 采用了一种**基于工具驱动的父子层级协同架构**。在这种设计中，Agent 之间的协同不是自动化的群体智能，而是通过明确的指令和工具调用实现的。

### 1.1 核心协调工具
*   **`sessions_spawn`**：主 Agent（Parent）通过该工具创建子 Agent（Sub-agent）。创建时会指定具体的 `task`（任务描述）和 `model`。
*   **`subagents`**：这是一个综合性的编排工具，允许主 Agent 列表查看（List）、终止（Kill）或引导（Steer）已创建的子 Agent。
*   **任务拆分流**：
    1.  主 Agent 识别到一个复杂任务（如：同时研究三个不同的库）。
    2.  主 Agent 调用 `sessions_spawn` 并发或顺序启动多个子 Agent，每个子 Agent 被赋予一个专注的子任务。
    3.  子 Agent 完成后，其结果通常通过会话记录或显式的消息发送（`sessions_send`）反馈给主 Agent。

## 2. 主 Agent 与子 Agent 的生命周期管理

OpenClaw 实现了严格的**引用追踪与递归生命周期管理**，确保了系统的资源可控性。

### 2.1 标识与追踪
*   **Session Key 层级**：系统使用类似 `agent:main:subagent:[id]` 的命名约定。这种层级化的 Key 结构使得系统能够追踪任何 Agent 的血缘关系。
*   **`spawnedBy` 属性**：在子 Agent 的注册记录中，明确存储了 `spawnedBy`（由谁创建）字段。

### 2.2 生命周期阶段
1.  **诞生 (Spawn)**：通过 `spawnSubagentDirect` 初始化。此时会检查 `maxSpawnDepth`（最大嵌套深度），防止 Agent 无限递归创建子 Agent 导致系统崩溃。
2.  **执行 (Execution)**：子 Agent 拥有独立的事件循环和 Context。
3.  **受控终止 (Controlled Termination)**：
    *   **递归销毁**：当主 Agent 终止或通过 `subagents kill` 显式销毁某个子 Agent 时，系统会执行递归清理（`killDescendantSubagentRuns`），确保子 Agent 产生的所有孙子 Agent 也会被一并清理。
4.  **结果回收**：子 Agent 的输出被视为父 Agent 的 `tool_result`，从而闭环任务。

## 3. 状态冲突与隔离机制

### 3.1 环境隔离 (Sandbox)
*   **独立的 Session Store**：每个子 Agent 拥有自己独立的 `AgentMessage` 历史记录，思考过程不会污染主 Agent 上下文。
*   **可见性控制**：通过 `sessionToolsVisibility: "spawned"` 限制子 Agent 只能操作其衍生的会话。

### 3.2 冲突解决策略
*   **无状态倾向**：子 Agent 倾向于被设计为“任务处理器”，规避了长期状态同步的冲突。
*   **steer 机制**：如果主 Agent 发现子 Agent 陷入死循环，可以通过 `subagents steer` 强行干预其指令流。

## 4. 总结与可扩展性评估

| 维度 | 设计模式 | 意义 |
| :--- | :--- | :--- |
| **任务拆分** | 显式 Tool-call | 保证任务分发的确定性。 |
| **错误隔离** | 独立 Session + 递归 Kill | 单个子任务崩溃不影响全局。 |
| **扩展性** | 插件化 Tool 系统 | 可轻松增加新的协同工具。 |

---
*存储路径：_dev_doc_oc/agent_orchestration_analysis.md*
