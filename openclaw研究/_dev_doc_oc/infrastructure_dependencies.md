# OpenClaw 基础设施与外部依赖分析

除了核心的 `pi-mono` (PI Agent SDK) 之外，OpenClaw 还依赖于一系列基础设施和外部服务来构建其完整的 Gateway、多模态处理和安全执行能力。

## 1. 外部 npm 依赖 (关键部分)

从 `package.json` 和代码中可以看出，OpenClaw 依赖以下关键库：

| 类别 | 依赖包 | 用途 |
| :--- | :--- | :--- |
| **Agent SDK** | `@mariozechner/pi-agent-core` | Agent 核心逻辑、Session 管理。 |
| | `@mariozechner/pi-coding-agent` | 专用于编码的 Agent 扩展（Code Interpreter 等）。 |
| **CLI & Runtime** | `commander` | CLI 命令行解析 (`src/cli/`). |
| | `ws` | WebSocket 服务器与客户端，用于 Gateway 通信。 |
| | `json5` | 解析更宽松的 JSON 配置文件。 |
| **File System** | `fs` (Node.js builtin) | 大量使用 `fs.promises` 进行文件操作，不依赖 ORM。 |
| **System** | `node:child_process` | 执行 `exec` 命令、启动子进程。 |
| | `node:crypto` | 生成 UUID、计算 Hash。 |

## 2. 基础设施组件 (Infrastructure)

OpenClaw 并没有使用传统的数据库（如 MySQL, PostgreSQL, Redis），而是采用了 **File-based Persistence（基于文件的持久化）** 和 **In-Memory State（内存状态）** 相结合的策略。

### 2.1 存储与持久化 (Storage)

OpenClaw 极度依赖文件系统来存储所有状态。这种设计使其易于部署、迁移和备份，无需维护额外的数据库服务。

*   **Session History (`.jsonl`)**:
    *   Agent 的对话历史以 JSONL 格式存储在 `~/.openclaw/sessions/`。
    *   每次对话追加一行，无需数据库写入。
*   **Cron Jobs (`jobs.json`)**:
    *   定时任务存储在 JSON 文件中 (`src/cron/store.ts`)。
*   **Device Auth (`device-auth.json`)**:
    *   设备配对和鉴权令牌存储在 `~/.openclaw/identity/device-auth.json`。
*   **Delivery Queue (File Queue)**:
    *   出站消息队列（Telegram/Slack 等回复）使用文件系统队列 (`src/infra/outbound/delivery-queue.ts`)。
    *   每个待发送消息保存为一个 JSON 文件，发送成功后删除。
    *   **优势**: 进程崩溃不丢失消息，天然持久化。

### 2.2 消息通道 (Channels)

虽然不直接依赖数据库，但 OpenClaw 依赖外部消息平台的 API 服务：

*   **Telegram**: 通过 `telegraf` (或直接 HTTP API) 与 Telegram Bot API 交互。
*   **Slack**: 使用 Slack Web API。
*   **Discord**: 使用 Discord API。
*   **WhatsApp / Signal / iMessage**: 通常需要运行在本地的辅助服务或 Bridge。

### 2.3 网络与服务发现 (Networking)

*   **WebSocket Gateway**:
    *   OpenClaw 自建了一个 WebSocket 服务器 (`src/gateway/server-ws-runtime.ts`)。
    *   用于 CLI 远程控制、前端 UI (`openclaw dashboard`) 实时更新、以及可能的分布式 Node 连接。
*   **Tailscale Integration**:
    *   原生集成了 Tailscale (`src/infra/tailscale.ts`)，用于安全地将本地 Gateway 暴露给外网或组成私有网络。
*   **mDNS (Bonjour)**:
    *   用于局域网内的 Gateway 自动发现 (`src/infra/bonjour.ts`)。

### 2.4 沙盒执行 (Sandbox)

*   **Docker (Optional)**:
    *   虽然代码中包含 `docker-compose.yml`，但这主要是为了开发和测试环境（如启动测试用的模拟服务）。
    *   Agent 的代码执行默认在宿主机（Host）运行，但支持配置 Docker 容器作为 Sandbox 环境。

## 3. 核心设计哲学：去数据库化 (No-Database Architecture)

OpenClaw 的一个显著特征是**完全没有引入 SQL/NoSQL 数据库**。

*   **理由**: Agent 的状态主要是线性的对话日志（Log-structured），非常适合追加写入文件。
*   **优势**: 
    *   **部署简单**: `npm install -g openclaw` 即可运行，不需要 `docker run postgres`。
    *   **透明性**: 用户可以直接用文本编辑器查看和修改 Session 文件。
    *   **Git 友好**: 配置文件和部分状态可以纳入版本控制。

## 4. 总结

OpenClaw 是一个 **Self-Contained (自包含)** 的系统。

*   **除了 Node.js Runtime 和 npm 包，它没有强制的外部基础设施依赖**。
*   它用文件系统解决了数据库的需求。
*   它用内存和 WebSocket 解决了消息队列和实时通信的需求。
*   它用 API 集成解决了多模态交互的需求。

这种轻量级架构使得它既可以运行在强大的服务器上，也可以运行在树莓派或个人笔记本上，非常符合 "Personal AI Agent" 的定位。
