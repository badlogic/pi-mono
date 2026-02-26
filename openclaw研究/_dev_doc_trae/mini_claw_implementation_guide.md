# 使用 pi-mono 构建简版 OpenClaw 分析文档

本文档分析 OpenClaw 的核心架构，帮助你理解使用 `pi-mono`（`@mariozechner/pi-coding-agent` 等）构建简版时，哪些模块是必须的，哪些可以省略。

---

## 一、架构概览

### 1.1 OpenClaw 核心组件

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw 架构                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Gateway   │  │    CLI      │  │   Web Control UI        │  │
│  │   Server    │  │  (openclaw) │  │   (浏览器仪表板)         │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                      │                │
│         └────────────────┼──────────────────────┘                │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │              Agent Runner (pi-embedded-runner)            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │   │
│  │  │   System    │  │   Tools     │  │   Session       │    │   │
│  │  │   Prompt    │  │   (exec,    │  │   Manager       │    │   │
│  │  │   Builder   │  │   read,     │  │   (JSONL)       │    │   │
│  │  │             │  │   write)    │  │                 │    │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘    │   │
│  └───────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │              pi-mono SDK (核心依赖)                        │   │
│  │  pi-ai | pi-agent-core | pi-coding-agent | pi-tui         │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 pi-mono 包依赖

| 包名 | 版本 | 用途 | 必要性 |
|-----|------|------|--------|
| `@mariozechner/pi-ai` | 0.53.0 | 核心 LLM 抽象：Model、streamSimple、消息类型、提供商 API | ✅ 必须 |
| `@mariozechner/pi-agent-core` | 0.53.0 | Agent 循环、工具执行、AgentMessage 类型 | ✅ 必须 |
| `@mariozechner/pi-coding-agent` | 0.53.0 | 高级 SDK：createAgentSession、SessionManager、内置工具 | ✅ 必须 |
| `@mariozechner/pi-tui` | 0.53.0 | 终端 UI 组件 | ⚠️ 可选（CLI 交互用） |

---

## 二、必须保留的模块

### 2.1 核心 Agent 循环 (Agent Loop) ✅ 必须

**文件位置**: `src/agents/pi-embedded-runner/`

这是 OpenClaw 的心脏，负责：
- 接收用户输入
- 调用 LLM
- 解析工具调用
- 执行工具
- 将结果回传 LLM
- 循环直到完成

**关键函数**:
| 函数 | 文件 | 用途 |
|-----|------|------|
| `runEmbeddedPiAgent()` | `run.ts` | 主入口，启动 Agent 运行 |
| `runEmbeddedAttempt()` | `run/attempt.ts` | 单次尝试逻辑，会话设置 |
| `createAgentSession()` | pi-coding-agent | 创建 Agent 会话 |

**最小实现代码示例**:
```typescript
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

const sessionManager = SessionManager.open("./session.jsonl");
const { session } = await createAgentSession({
  cwd: process.cwd(),
  model: "anthropic/claude-sonnet-4-20250514",
  tools: [], // 你的工具列表
  sessionManager,
});

await session.prompt("Hello!");
```

### 2.2 动态 System Prompt 构建器 ✅ 必须

**文件位置**: `src/agents/system-prompt.ts`

这是 OpenClaw 的"灵魂"，实现了 **"文件即上下文"** 的核心理念。

**必须实现的功能**:
| 功能 | 描述 |
|-----|------|
| Bootstrap 注入 | 读取 `AGENTS.md`、`TOOLS.md`、`SOUL.md` 并注入 Prompt |
| 运行时信息 | 注入当前时间、操作系统、工作目录 |
| 工具列表 | 列出可用工具及简短描述 |
| 安全护栏 | 简短的安全提醒 |

**最小实现代码示例**:
```typescript
import fs from "fs";

function buildSystemPrompt(workspaceDir: string): string {
  let prompt = "You are a helpful coding assistant.\n\n";
  
  // 注入 AGENTS.md
  const agentsPath = `${workspaceDir}/AGENTS.md`;
  if (fs.existsSync(agentsPath)) {
    prompt += "## Project Rules\n\n";
    prompt += fs.readFileSync(agentsPath, "utf-8");
    prompt += "\n\n";
  }
  
  // 注入运行时信息
  prompt += `## Runtime\n`;
  prompt += `Working directory: ${workspaceDir}\n`;
  prompt += `OS: ${process.platform}\n`;
  prompt += `Time: ${new Date().toISOString()}\n`;
  
  return prompt;
}
```

### 2.3 核心工具集 ✅ 必须

**文件位置**: `src/agents/pi-tools.ts`, `src/agents/bash-tools.ts`

没有工具的 Agent 只是个聊天机器人。以下是必须的工具：

| 工具名 | 用途 | 必要性 | 实现难度 |
|-------|------|--------|---------|
| `read` | 读取文件内容 | ✅ 必须 | 低（pi 内置） |
| `write` | 创建/覆盖文件 | ✅ 必须 | 低（pi 内置） |
| `edit` | 精确编辑文件 | ✅ 必须 | 低（pi 内置） |
| `exec` | 执行 Shell 命令 | ✅ 必须 | 中等 |
| `ls` / `glob` | 列出/查找文件 | ⚠️ 推荐 | 低（pi 内置） |
| `grep` | 搜索文件内容 | ⚠️ 推荐 | 低（pi 内置） |

**工具来源**:
```typescript
import { codingTools, createReadTool, createWriteTool, createEditTool } from "@mariozechner/pi-coding-agent";

// pi 内置的基础工具
const baseTools = codingTools;

// 或自定义工具
const readTool = createReadTool({ cwd: workspaceDir });
const writeTool = createWriteTool({ cwd: workspaceDir });
```

### 2.4 会话持久化 ✅ 必须

**文件位置**: `src/agents/pi-embedded-runner/session-manager-*.ts`

会话持久化让 Agent 拥有"记忆"，而不是每次都从零开始。

**关键组件**:
| 组件 | 用途 |
|-----|------|
| `SessionManager` | 管理会话历史（JSONL 格式） |
| `session.jsonl` | 会话历史文件 |

**最小实现**:
```typescript
import { SessionManager } from "@mariozechner/pi-coding-agent";

// 打开或创建会话文件
const sessionManager = SessionManager.open("./sessions/main.jsonl");

// 传递给 createAgentSession
const { session } = await createAgentSession({
  // ...
  sessionManager,
});
```

### 2.5 CLI 交互界面 ✅ 必须

**文件位置**: `src/cli/`

简版只需要一个简单的命令行界面。

**必须实现**:
- 接收用户输入
- 流式输出 Agent 响应
- 显示工具执行过程

**最小实现**:
```typescript
// cli.ts
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

async function main() {
  const userMessage = process.argv.slice(2).join(" ");
  
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    model: "anthropic/claude-sonnet-4-20250514",
    sessionManager: SessionManager.open("./session.jsonl"),
    tools: [], // 你的工具
  });
  
  // 流式输出
  for await (const event of session.promptStream(userMessage)) {
    if (event.type === "text") {
      process.stdout.write(event.text);
    }
  }
}

main();
```

---

## 三、可以省略的模块

### 3.1 Gateway Server ❌ 可省略

**文件位置**: `src/gateway/`

| 组件 | 复杂度 | 省略理由 |
|-----|--------|---------|
| HTTP Server | 高 | 单机版不需要 HTTP API |
| WebSocket | 高 | 不需要实时推送 |
| 多客户端管理 | 高 | 只有一个 CLI 客户端 |
| 健康检查 | 中 | 单机版不需要 |

**替代方案**: 直接在 CLI 进程中运行 Agent 逻辑。

### 3.2 多渠道路由 ❌ 可省略

**文件位置**: `src/routing/`, `extensions/*/`

| 渠道 | 复杂度 | 省略理由 |
|-----|--------|---------|
| Telegram | 高 | 需要 Bot API、Webhook |
| Slack | 高 | 需要 OAuth、事件订阅 |
| WhatsApp | 高 | 需要 QR 码登录、会话管理 |
| Discord | 高 | 需要 Bot Token、Gateway 连接 |
| iMessage | 高 | 需要 Apple 设备、证书 |

**替代方案**: 只支持本地终端 (stdin/stdout)。

### 3.3 沙盒环境 ❌ 可省略

**文件位置**: `src/agents/sandbox/`, `src/sandbox/`

| 组件 | 复杂度 | 省略理由 |
|-----|--------|---------|
| Docker 管理 | 高 | 容器生命周期管理复杂 |
| 卷挂载 | 中 | 路径映射容易出错 |
| 权限控制 | 中 | 安全策略配置繁琐 |

**替代方案**: 直接在宿主机运行（Host Mode）。

> ⚠️ **警告**: 这意味着 Agent 可以删除你的文件，请在安全的目录下测试！

### 3.4 技能插件系统 ❌ 可省略

**文件位置**: `src/agents/skills/`, `skills/`

| 组件 | 复杂度 | 省略理由 |
|-----|--------|---------|
| 动态加载 | 中 | 需要模块热加载 |
| 依赖管理 | 高 | 需要处理 npm 依赖 |
| 版本控制 | 中 | 需要版本兼容性检查 |

**替代方案**: 将所有工具硬编码在主程序中。

### 3.5 定时任务 (Cron) ❌ 可省略

**文件位置**: `src/cron/`, `src/agents/tools/cron-tool.ts`

| 组件 | 复杂度 | 省略理由 |
|-----|--------|---------|
| 调度器 | 中 | 需要持久化调度状态 |
| 唤醒机制 | 高 | 需要进程保活 |

**替代方案**: 暂不支持定时任务。

### 3.6 配置向导 (Onboarding) ❌ 可省略

**文件位置**: `src/wizard/`, `src/commands/onboard*.ts`

| 组件 | 复杂度 | 省略理由 |
|-----|--------|---------|
| 交互式向导 | 中 | 编写交互式 UI 耗时 |
| 多步骤流程 | 中 | 状态管理复杂 |

**替代方案**: 使用 `.env` 文件或 `config.json` 配置。

### 3.7 多代理路由 ❌ 可省略

**文件位置**: `src/routing/`, `src/agents/tools/subagents-tool.ts`

| 组件 | 复杂度 | 省略理由 |
|-----|--------|---------|
| 会话路由 | 中 | 需要会话 ID 映射 |
| 子代理管理 | 高 | 需要生命周期管理 |

**替代方案**: 只支持单一会话。

### 3.8 浏览器工具 ❌ 可省略

**文件位置**: `src/agents/tools/browser-tool.ts`, `src/browser/`

| 组件 | 复杂度 | 省略理由 |
|-----|--------|---------|
| Playwright 集成 | 高 | 需要浏览器二进制 |
| 页面自动化 | 高 | 需要处理动态内容 |

**替代方案**: 暂不支持浏览器操作。

### 3.9 Web 搜索/抓取 ⚠️ 可选

**文件位置**: `src/agents/tools/web-*.ts`

| 组件 | 复杂度 | 建议 |
|-----|--------|------|
| Web Search | 中 | 需要 Brave API Key |
| Web Fetch | 低 | 可用 node-fetch 实现 |

**替代方案**: 可后期添加。

### 3.10 记忆系统 ❌ 可省略

**文件位置**: `src/agents/tools/memory-tool.ts`, `extensions/memory-*/`

| 组件 | 复杂度 | 省略理由 |
|-----|--------|---------|
| 向量数据库 | 高 | 需要 LanceDB/SQLite-vec |
| 记忆搜索 | 中 | 需要嵌入模型 |

**替代方案**: 依赖会话历史和 `MEMORY.md` 文件。

---

## 四、模块优先级总结

### 4.1 优先级矩阵

| 优先级 | 模块 | 工作量 | 核心价值 |
|-------|------|--------|---------|
| P0 | Agent 循环 | 低 | ⭐⭐⭐⭐⭐ |
| P0 | System Prompt 构建 | 低 | ⭐⭐⭐⭐⭐ |
| P0 | 核心工具 (read/write/exec) | 低 | ⭐⭐⭐⭐⭐ |
| P0 | 会话持久化 | 低 | ⭐⭐⭐⭐ |
| P0 | CLI 交互 | 低 | ⭐⭐⭐⭐ |
| P1 | grep/glob 工具 | 低 | ⭐⭐⭐ |
| P1 | 流式输出 | 中 | ⭐⭐⭐ |
| P2 | Web Fetch | 低 | ⭐⭐ |
| P2 | 图片处理 | 中 | ⭐⭐ |
| P3 | Gateway Server | 高 | ⭐ |
| P3 | 多渠道路由 | 高 | ⭐ |
| P3 | 沙盒环境 | 高 | ⭐ |
| P3 | 技能系统 | 中 | ⭐ |

### 4.2 MVP 功能清单

**第一版 MVP 必须实现**:
- [x] 使用 pi-coding-agent 创建 Agent 会话
- [x] 动态读取 `AGENTS.md` 注入 System Prompt
- [x] 注册 read/write/exec 工具
- [x] 会话持久化 (JSONL)
- [x] CLI 输入/输出

**MVP 代码量估算**: ~200-500 行 TypeScript

---

## 五、推荐开发路径

### 阶段一：Hello World (1-2 小时)

1. 初始化项目，安装 pi-mono 依赖
2. 配置 `.env` (API Key)
3. 创建简单脚本，发送消息并打印响应

```bash
npm init -y
npm install @mariozechner/pi-coding-agent @mariozechner/pi-ai
```

### 阶段二：工具能力 (2-4 小时)

1. 引入 pi 内置工具
2. 测试 exec 工具（运行 `echo "test"`）
3. 测试 write 工具（创建文件）

### 阶段三：文件上下文 (2-3 小时)

1. 实现 `buildSystemPrompt()` 函数
2. 读取 `AGENTS.md` 并注入
3. 测试 Agent 是否遵守规则

### 阶段四：持久化 (1-2 小时)

1. 配置 SessionManager
2. 测试会话记忆

### 阶段五：完善 (按需)

1. 添加更多工具
2. 优化 CLI 体验
3. 添加错误处理

---

## 六、关键代码参考

### 6.1 最小可运行示例

```typescript
// mini-claw.ts
import { createAgentSession, SessionManager, codingTools } from "@mariozechner/pi-coding-agent";
import fs from "fs";
import path from "path";

async function main() {
  const workspaceDir = process.cwd();
  const sessionFile = path.join(workspaceDir, ".mini-claw", "session.jsonl");
  
  // 确保目录存在
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  
  // 1. 构建 System Prompt
  let systemPrompt = "You are a helpful coding assistant.\n\n";
  systemPrompt += `Working directory: ${workspaceDir}\n`;
  systemPrompt += `OS: ${process.platform}\n\n`;
  
  const agentsPath = path.join(workspaceDir, "AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    systemPrompt += "## Project Rules\n\n";
    systemPrompt += fs.readFileSync(agentsPath, "utf-8");
  }
  
  // 2. 创建会话
  const sessionManager = SessionManager.open(sessionFile);
  
  const { session } = await createAgentSession({
    cwd: workspaceDir,
    model: process.env.MODEL || "anthropic/claude-sonnet-4-20250514",
    tools: codingTools, // pi 内置工具
    sessionManager,
  });
  
  // 3. 设置 System Prompt
  session.setSystemPrompt(systemPrompt);
  
  // 4. 获取用户输入
  const userMessage = process.argv.slice(2).join(" ") || "Hello!";
  
  // 5. 发送消息并流式输出
  console.log("\n🤖 Agent:\n");
  for await (const event of session.promptStream(userMessage)) {
    if (event.type === "text") {
      process.stdout.write(event.text);
    } else if (event.type === "tool_start") {
      console.log(`\n🔧 Using tool: ${event.tool}`);
    } else if (event.type === "tool_end") {
      console.log(`\n✅ Tool completed`);
    }
  }
  
  console.log("\n");
}

main().catch(console.error);
```

### 6.2 package.json 示例

```json
{
  "name": "mini-claw",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node mini-claw.ts"
  },
  "dependencies": {
    "@mariozechner/pi-ai": "^0.53.0",
    "@mariozechner/pi-agent-core": "^0.53.0",
    "@mariozechner/pi-coding-agent": "^0.53.0"
  }
}
```

### 6.3 .env 示例

```env
ANTHROPIC_API_KEY=sk-ant-...
MODEL=anthropic/claude-sonnet-4-20250514
```

---

## 七、总结

使用 pi-mono 构建简版 OpenClaw，核心在于：

> **CLI + 强力 LLM + 本地文件读写权限 + 自动读取 Markdown 配置**

只要做到了这四点，就能获得 OpenClaw **80% 的核心体验**，而代码量可以控制在 **500 行以内**。

### 可以获得的体验
- ✅ 文件即上下文（AGENTS.md 控制行为）
- ✅ 强大的代码编辑能力
- ✅ Shell 命令执行
- ✅ 会话记忆持久化

### 暂时失去的能力
- ❌ 多渠道消息（Telegram/Slack 等）
- ❌ 远程访问（Gateway）
- ❌ 沙盒安全隔离
- ❌ 多代理协作
- ❌ 定时任务

**建议**: 先实现 MVP，验证核心价值后再逐步添加高级功能。
