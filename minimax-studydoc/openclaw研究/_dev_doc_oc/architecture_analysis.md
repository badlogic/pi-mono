# OpenClaw 核心架构与流程分析

OpenClaw 是一个基于 TypeScript 的多模态 AI 代理网关和编排框架。它不同于 LangGraph 或 AutoGen，更侧重于**生产环境的代理编排**、**多渠道消息路由**、**沙盒安全执行**以及**状态持久化**。

## 1. 核心架构概述

OpenClaw 的核心架构围绕 "Gateway"（网关）模式构建，充当用户消息通道（Telegram, Slack, HTTP 等）与 AI 代理执行环境之间的路由器和协调器。

主要组件包括：

1.  **Gateway Server (`src/gateway/`)**: 系统的核心守护进程。
    *   管理消息通道连接。
    *   路由消息到对应的 Agent Session。
    *   维护 WebSocket 服务，供 CLI 和前端 UI 连接。
    *   处理插件加载、定时任务 (Cron)、健康检查。
2.  **CLI (`src/cli/`)**: 系统的主要交互入口。
    *   提供 `openclaw agent` (单次运行)、`gateway start` (守护进程)、`onboard` (配置向导) 等命令。
    *   支持本地嵌入式运行 (`--local`) 和通过网关运行两种模式。
3.  **Agent Runner (`src/agents/pi-embedded-runner/`)**: 实际执行 Agent 逻辑的引擎。
    *   基于 `@mariozechner/pi-coding-agent` (PI SDK) 构建。
    *   负责构建 System Prompt、加载工具、执行 LLM 推理循环、处理工具调用。
    *   管理会话状态（History, Context Window, Compaction）。
4.  **Auto-Reply & Routing (`src/auto-reply/`, `src/routing/`)**: 决定何时以及如何回复用户。
    *   处理消息队列、去重、并发控制。
    *   将用户 ID (E.164 号码等) 映射到持久化的 `SessionKey`。

## 2. 运行流程详解

### 2.1 启动与初始化

入口点是 `src/entry.ts`，它会加载 CLI。`src/cli/run-main.ts` 解析命令并路由。

如果是启动网关 (`gateway run`):
1.  `startGatewayServer` 初始化配置、日志、插件系统。
2.  加载并启动各个 Channel 插件 (Telegram, Slack, etc.)。
3.  启动 HTTP/WebSocket 服务器，监听 API 请求。
4.  初始化 Agent 运行时状态 (Run State, Dedupe)。

### 2.2 消息处理流程 (User -> Agent)

当用户发送消息（例如通过 CLI `openclaw agent -m "hello"` 或通过 Telegram）：

1.  **接收**: Gateway 接收到请求，解析出 `to` (目标用户/SessionKey) 和 `message`。
2.  **路由**: `resolveSessionKeyForRequest` 确定唯一的 Session ID。
3.  **入队**: 请求被放入 `CommandQueue` (基于 Lane 并发控制)。
4.  **调度**: `runEmbeddedPiAgent` 被调用，开始 Agent 执行周期。

### 2.3 Agent 执行周期 (`runEmbeddedAttempt`)

这是 OpenClaw 与其他框架最不同的地方，位于 `src/agents/pi-embedded-runner/run/attempt.ts`：

1.  **工作区准备**:
    *   解析 `workspaceDir` (每个 Agent 有独立的工作区)。
    *   解析 **Sandbox** 环境（如果启用），准备 Docker 容器路径映射。
2.  **上下文构建 (Context Construction)**:
    *   **动态 System Prompt**: 调用 `buildEmbeddedSystemPrompt`。
    *   **注入 Bootstrap Files**: 自动读取工作区中的 `AGENTS.md`, `TOOLS.md`, `SOUL.md` 等文件并注入到 Prompt 中。这是 OpenClaw 的特色，允许用户通过编辑 Markdown 文件直接控制 Agent 行为。
    *   **Skills 加载**: 扫描可用 Skills，生成 `<available_skills>` 列表注入 Prompt。
3.  **Session 加载**:
    *   加载持久化的会话历史 (`sessions/*.jsonl`)。
    *   应用 **Compaction** (压缩) 和 **Pruning** (修剪) 策略，防止 Context Window 溢出。
    *   如果发现历史记录中的图片，会重新注入到消息中。
4.  **推理循环 (The Loop)**:
    *   调用 LLM (`activeSession.prompt`).
    *   **工具执行**: 如果 LLM 请求工具调用，OpenClaw 会在本地或 Sandbox 中执行工具。
        *   **工具集**: 提供 `read`, `write`, `exec` (Shell), `browser` 等核心工具。
        *   **安全**: 执行前检查权限、Sandbox 策略。
    *   **结果回填**: 工具结果被送回 LLM，继续下一轮推理。
5.  **结束与回调**:
    *   运行完成后，触发 `agent_end` 钩子。
    *   如果有回复，通过 Gateway 发回给用户。

## 3. 与其他框架的对比

| 特性 | OpenClaw | LangGraph / DeepAgents | AutoGen |
| :--- | :--- | :--- | :--- |
| **核心理念** | **Gateway + OS Interface**。不仅仅是 LLM 编排，更是一个连接真实世界（消息通道、Shell、浏览器）的操作系统接口。 | **Graph-based State Machine**。强调通过图结构定义复杂的控制流和状态转移。 | **Multi-Agent Conversation**。强调多个 Agent 之间的对话协作模式。 |
| **Prompt 管理** | **文件驱动 (Files-as-Prompt)**。通过 `AGENTS.md`, `SOUL.md` 等本地文件动态注入 Prompt，非常适合开发者直接控制。 | 通常在代码中定义或通过 Prompt 模板管理。 | 在 Agent 配置中定义 System Message。 |
| **状态持久化** | **文件系统优先**。会话记录为 JSONL 文件，Workspace 是真实的文件目录。强调“长短期记忆”通过文件实现。 | 通常依赖 Checkpointer (数据库) 来持久化图状态。 | 默认较弱，通常是内存中的对话历史，持久化需额外配置。 |
| **沙盒 (Sandbox)** | **原生集成 Docker**。可以配置 Agent 在 Docker 容器中执行 `exec` 命令，与宿主机隔离。 | 通常需要外部工具（如 E2B）集成。 | 支持 Docker 执行，但通常侧重于代码生成后的执行。 |
| **多模态** | **原生支持**。自动检测 Prompt 中的图片引用，支持 Channel 传入的语音/图片，集成 TTS/STT。 | 支持，但通常作为工具或节点能力。 | 支持，视模型能力而定。 |
| **技能/工具** | **Skills 插件系统**。标准化的 `SKILL.md` 格式，Agent 可以“阅读”技能文档来学习新能力。 |通过 ToolNode 集成 Python 函数。 | 通过注册 Python 函数作为工具。 |
| **并发模型** | **Lanes & Queues**。基于队列的并发控制，防止同一个 Session 并发写入，支持 Cron 定时任务。 | 异步执行，基于图的并行节点。 | 主要是顺序的对话轮次，群聊模式支持一定的并发。 |

## 4. 关键差异总结

**OpenClaw 更像是一个“AI 代理操作系统”或“服务器”**，而 LangGraph 和 AutoGen 更像是“AI 应用开发库”。

*   **OpenClaw** 开箱即用，提供完整的 CLI、HTTP Server、消息路由、持久化、Sandbox 和 Cron。你不需要写代码来“启动”一个 Agent，你只需要配置它，然后通过聊天或 CLI 与它交互。它强调**User-in-the-loop**的交互体验。
*   **LangGraph/AutoGen** 需要你编写 Python 代码来定义 Agent 的结构、流转逻辑和工具。它们更适合构建特定的、嵌入到其他应用中的 AI 逻辑。

OpenClaw 的 **"Files-as-Context" (文件即上下文)** 设计是其最显著的特征之一，这使得调整 Agent 行为就像编辑 Markdown 文档一样简单直观。
