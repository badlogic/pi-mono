# 基于 LangGraph 实现 OpenClaw 核心功能深度技术分析

如果你希望不依赖 `pi-mono` (PI SDK)，而是利用 **LangGraph** (LangChain 生态中的图编排框架) 来实现类似 OpenClaw 的功能，你需要从底层的状态机管理、工具集成、文件驱动上下文以及多渠道网关四个维度进行重构。

以下是详细的架构设计与实现方案。

## 1. 核心架构映射 (Architectural Mapping)

OpenClaw 的组件在 LangGraph 生态中可以找到对应的概念：

| OpenClaw 组件 | LangGraph 对应实现 | 说明 |
| :--- | :--- | :--- |
| **Agent Loop** | `StateGraph` | 使用有向图定义 Agent 的“思考-行动-观察”循环。 |
| **Session History** | `Checkpointer` (Sqlite/Postgres) | LangGraph 的持久化层，保存 Thread 状态。 |
| **File-driven Context** | **Bootstrap Node** (自定义) | 在图的入口处读取 `SOUL.md` 等文件并注入。 |
| **Shell/FS Tools** | `ShellTool` + `FileTools` | LangChain 提供的原生工具集。 |
| **Compaction** | **Compactor Node** (条件节点) | 当消息列表过长时，触发摘要节点的逻辑。 |
| **Sub-agents** | `Sub-graphs` / `Supervisor` | LangGraph 支持图的嵌套调用。 |

## 2. 状态定义 (State Schema)

OpenClaw 依赖文件系统作为状态。在 LangGraph 中，你需要定义一个 `TypedDict` 来承载整个会话的状态。

```python
from typing import Annotated, TypedDict, List, Union
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    # 使用 add_messages 允许增量更新消息历史
    messages: Annotated[List[BaseMessage], add_messages]
    # 当前工作区路径
    workspace_dir: str
    # 注入的系统指令（SOUL, AGENTS 等）
    system_instructions: str
    # 运行时信息（时间、OS等）
    runtime_info: dict
```

## 3. 图节点设计 (Node Design)

你需要构建以下关键节点来实现 OpenClaw 的特性：

### 3.1 Bootstrap 节点 (注入“灵魂”)
这个节点负责在 Agent 运行前读取本地文件，复刻 OpenClaw 的 `SOUL.md` 逻辑。

```python
def bootstrap_node(state: AgentState):
    workspace = state["workspace_dir"]
    instructions = []
    
    # 模拟 OpenClaw 的文件注入逻辑
    for filename in ["SOUL.md", "AGENTS.md", "TOOLS.md"]:
        path = f"{workspace}/{filename}"
        if os.path.exists(path):
            with open(path, "r") as f:
                instructions.append(f"## {filename}\n{f.read()}")
    
    return {"system_instructions": "\n\n".join(instructions)}
```

### 3.2 Agent 决策节点 (Decision)
调用 LLM 并决定下一步是回复还是调用工具。

```python
def call_model(state: AgentState):
    # 组合 System Prompt
    system_prompt = f"System: {state['system_instructions']}\nRuntime: {state['runtime_info']}"
    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    
    # 调用模型（需绑定工具定义）
    response = model.bind_tools(tools).invoke(messages)
    return {"messages": [response]}
```

### 3.3 Compaction 节点 (Token 优化)
当 `len(messages)` 超过阈值时，自动触发总结逻辑。

```python
def summarize_history(state: AgentState):
    # 只保留最近 5 条，之前的全部总结
    to_summarize = state["messages"][:-5]
    summary = summarizer_model.invoke(f"Summarize this: {to_summarize}")
    
    # 在 LangGraph 中，你可以通过返回特殊的 ID 来删除旧消息
    # 并添加一条包含摘要的新消息
    return {"messages": [SummaryMessage(content=summary.content)]}
```

## 4. 工具系统 (Universal Tooling)

要达到 OpenClaw 的能力，必须提供以下高权限工具：

1.  **ShellTool**: 封装 Python 的 `subprocess`，允许执行任意 Bash。
2.  **FileSystemTools**: `ReadFile`, `WriteFile`, `ListDirectory`。
3.  **Search/Browser**: 集成 `Tavily` (搜索) 和 `Playwright` (浏览器)。

**安全注意**：如果要复刻 OpenClaw 的沙盒，你需要将整个 LangGraph 的工具执行部分运行在 Docker 容器中。

## 5. 网关层实现 (The Gateway)

LangGraph 只是一个库，不具备 OpenClaw 的多渠道网关能力。你需要自己写一个服务器来包装它：

1.  **API 接口**: 使用 `FastAPI` 暴露接口。
2.  **Thread 管理**: 将 Telegram/Slack 的 `user_id` 或 `chat_id` 映射到 LangGraph 的 `thread_id`。
3.  **持久化**: 使用 `SqliteSaver` 实现 `Checkpointer`。
    ```python
    from langgraph.checkpoint.sqlite import SqliteSaver
    
    with SqliteSaver.from_conn_string(":memory:") as checkpointer:
        app = workflow.compile(checkpointer=checkpointer)
        # 通过 thread_id 实现 Session 隔离
        app.invoke(input_data, config={"configurable": {"thread_id": "user_123"}})
    ```

## 6. 实现路线图 (Roadmap)

### 第一阶段：单机 CLI 版 (MVP)
*   [ ] 实现 `StateGraph` 的基本循环。
*   [ ] 编写 `Bootstrap` 逻辑，支持读取 `SOUL.md`。
*   [ ] 集成 `ShellTool` 和文件读写工具。
*   [ ] 使用 `SqliteSaver` 实现简单的对话记忆。

### 第二阶段：沙盒与安全
*   [ ] 实现 Docker 化的 Tool 执行器。
*   [ ] 添加 `exec-approval` 节点：在工具执行前，图进入 `interrupt` 状态，等待用户在终端输入 `yes` 才能继续。

### 第三阶段：网关与消息路由
*   [ ] 编写 Telegram/Slack Bot 逻辑。
*   [ ] 将消息异步推送到 LangGraph 队列。
*   [ ] 实现 Streaming 输出（使用 `app.stream()`）并实时发回消息渠道。

## 7. 总结：为什么要这么麻烦？

如果你不使用 `pi-mono`：
*   **好处**: 你可以完全控制 Agent 的状态转移逻辑，利用 LangChain 极其丰富的生态（1000+ 工具），并且更方便地集成到现有的 Python 基础设施中。
*   **代价**: 你需要重新实现 OpenClaw 已经打磨好的 **Session 锁机制、流式输出解析、多渠道路由、以及极其复杂的自动压缩算法**。

**推荐建议**：如果你只是想定制 Agent 逻辑，可以尝试在 OpenClaw 的基础上开发 Python 插件；如果你是要构建一个完全不同的企业级工作流，那么基于 LangGraph 复刻 OpenClaw 的“文件驱动”理念是一个非常明智的选择。
