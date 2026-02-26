# 使用 pi-mono 构建简版 OpenClaw (Mini-Claw) 开发指南

如果你打算基于 `pi-mono`（即 `@mariozechner/pi-agent-core` 和 `@mariozechner/pi-coding-agent`）构建一个简化版的 OpenClaw，你的目标应该是剥离复杂的服务器架构，保留“**文件即上下文**”和“**强工具执行力**”的核心体验。

以下是构建“Mini-Claw”的建议架构。

## 1. 核心保留模块 (Must-Haves)

这部分是你无法省去的，它们构成了 Agent 的最小运行闭环。

### A. 基础代理循环 (Agent Loop)
OpenClaw 的核心是 `pi-embedded-runner`。你需要利用 SDK 实现以下逻辑：
*   **Session Management**: 使用 `createAgentSession` 和 `SessionManager`。这是为了保存对话历史（JSONL 格式），否则 Agent 只有金鱼的记忆。
*   **The Loop**: 接收用户输入 -> 调用 LLM -> 解析工具调用 -> 执行工具 -> 将结果回传 LLM -> 循环直到 LLM 输出文本。`pi-coding-agent` 封装了大部分这方面的逻辑。

### B. 动态 System Prompt 构建器
这是 OpenClaw 的“灵魂”。不要只给 LLM 一个静态的 Prompt。
*   **Bootstrap Injection**: 必须实现一个函数，在每次运行时读取当前工作目录下的 `AGENTS.md` (规则) 和 `TOOLS.md` (工具说明)，并将它们拼接进 System Prompt。
*   **Runtime Info**: 注入当前时间、操作系统信息、工作目录路径。

### C. 核心工具集 (Core Tools)
没有工具的 Agent 只是个聊天机器人。你需要注册以下工具：
*   **File System**: `read`, `write`, `ls` (或者 `glob`)。
*   **Execution**: `exec` (运行 Shell 命令)。这是 OpenClaw 强大的原因，允许它安装依赖、运行测试等。
*   **Thinking**: 如果模型支持（或者通过 Prompt 模拟），确保支持 `<think>` 标签的处理。

### D. CLI 交互界面
不要做 Web UI，直接做 CLI。
*   实现一个简单的 `node cli.js -m "your message"`。
*   实现 Streaming 输出，将 Agent 的思考过程和工具输出实时打印到控制台。

## 2. 可以暂时省略的模块 (Nice-to-Haves / Omit initially)

为了快速跑通 MVP (Minimum Viable Product)，以下部分极其复杂且非核心逻辑，建议初期直接砍掉：

### A. Gateway Server & WebSockets
*   **省略理由**: OpenClaw 的 Gateway 负责多客户端连接、鉴权、HTTP API 转换。对于单机版工具，这完全是过度设计。
*   **替代方案**: 直接在 CLI 进程中运行 Agent 逻辑。

### B. 多渠道路由 (Routing & Channels)
*   **省略理由**: 对接 Telegram, Slack, WhatsApp 需要大量的 API 适配和 Webhook 处理。
*   **替代方案**: 只支持本地终端 (Standard Input/Output)。

### C. 沙盒环境 (Docker Sandbox)
*   **省略理由**: 管理 Docker 容器的生命周期、挂载卷、权限控制非常复杂。
*   **替代方案**: 直接在宿主机运行（Host Mode）。**警告**：这意味着 Agent 可以删除你的文件，所以开发时请在安全的目录下测试。

### D. 技能插件系统 (Dynamic Skills/Plugins)
*   **省略理由**: OpenClaw 的 Skills 系统涉及动态加载、依赖管理和版本控制。
*   **替代方案**: 将所有工具硬编码在主程序中，或者通过简单的 `require` 加载。

### E. 定时任务 (Cron)
*   **省略理由**: 需要一个持久化的调度器和唤醒机制。
*   **替代方案**: 暂时不支持。

### F. 复杂的配置向导 (Onboarding Wizard)
*   **省略理由**: 编写交互式向导很耗时。
*   **替代方案**: 使用 `.env` 文件或 `config.json` 进行配置（API Key, Model ID 等）。

## 3. 推荐的开发步骤

### 第一步：跑通 Hello World
1.  初始化项目，安装 `@mariozechner/pi-coding-agent`。
2.  配置 `.env` (包含 ANTHROPIC_API_KEY 等)。
3.  写一个脚本，创建一个 `AgentSession`，发送 "Hello"，并把结果打印出来。

### 第二步：赋予工具能力 (Tools)
1.  引入 `pi-tools` 中的基础工具定义。
2.  确保 `exec` 工具可用（尝试让 Agent 运行 `echo "test"`）。
3.  确保 `write` 工具可用（尝试让 Agent 创建一个文件）。

### 第三步：实现“文件上下文” (The OpenClaw Magic)
1.  创建一个函数 `buildSystemPrompt()`。
2.  在该函数中，读取 `process.cwd() + '/AGENTS.md'`。
3.  如果文件存在，将其内容添加到 System Prompt 的末尾。
4.  测试：在 `AGENTS.md` 里写“每次回复都以此结尾：[Verified]”，看看 Agent 是否遵守。

### 第四步：持久化 (Persistence)
1.  确保 `SessionManager` 指向本地的一个 `.jsonl` 文件。
2.  运行程序，聊两句，退出。
3.  再次运行，确保 Agent 记得刚才的对话。

## 4. 关键代码结构参考

```typescript
// 伪代码示例

import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import fs from "fs";

async function run() {
  // 1. 构建 System Prompt
  let systemPrompt = "You are a helpful coding assistant.";
  if (fs.existsSync("./AGENTS.md")) {
    systemPrompt += "\n\n" + fs.readFileSync("./AGENTS.md", "utf-8");
  }

  // 2. 初始化 Session
  const sessionManager = SessionManager.open("./session_history.jsonl");
  
  // 3. 创建 Agent
  const { session } = await createAgentSession({
    model: { provider: "anthropic", model: "claude-3-5-sonnet-latest" },
    tools: [/* fs tools, exec tools */],
    sessionManager
  });

  // 4. 设置 Prompt
  session.agent.setSystemPrompt(systemPrompt);

  // 5. 发送消息
  const userMessage = process.argv[2] || "Check current directory";
  await session.prompt(userMessage); // 这里需要处理 streaming 输出
}

run();
```

## 总结

简版 OpenClaw 的核心在于：**CLI + 强力 LLM + 本地文件读写权限 + 自动读取 Markdown 配置**。只要做到了这四点，就能获得 OpenClaw 80% 的核心体验。
