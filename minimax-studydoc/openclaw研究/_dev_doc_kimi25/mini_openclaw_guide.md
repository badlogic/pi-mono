# 简版 OpenClaw 实现指南 (pi-mono 版)

本文档分析 OpenClaw 的核心架构，帮助你理解使用 `pi-mono`（`@mariozechner/pi-coding-agent` 等）构建简版时，哪些模块是必须的，哪些可以省略。

---

## 一、OpenClaw 架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OpenClaw 完整架构                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 1: CLI & TUI (src/cli/, src/tui/)                                │
│    - 命令行界面、终端交互、配置管理                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 2: Gateway Server (src/gateway/)                                 │
│    - WebSocket/HTTP API、节点管理、会话管理、插件系统                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 3: Channels (src/channels/, extensions/)                         │
│    - Telegram、Discord、Slack、WhatsApp 等消息通道                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 4: Agent Core (src/agents/)                                      │
│    - 工具系统、Prompt 管理、Session 管理、技能系统                            │
│    - 依赖: @mariozechner/pi-coding-agent                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 5: Infrastructure (src/infra/, src/config/)                      │
│    - 配置加载、日志、进程管理、文件系统                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 二、pi-mono 核心依赖分析

### 必须依赖 (核心功能)

| 包名 | 版本 | 功能 | 必要性 |
|------|------|------|--------|
| `@mariozechner/pi-ai` | 0.53.0 | 核心 LLM 抽象：Model、streamSimple、消息类型、提供商 API | 必须 |
| `@mariozechner/pi-agent-core` | 0.53.0 | Agent 循环、工具执行、AgentMessage 类型 | 必须 |
| `@mariozechner/pi-coding-agent` | 0.53.0 | 高级 SDK：createAgentSession、SessionManager、内置工具 | 必须 |
| `@mariozechner/pi-tui` | 0.53.0 | 终端 UI 组件 | 可选（CLI 交互用） |

### 代码示例：pi-mono 基础用法

```typescript
// 简版 OpenClaw 的核心只需这几行
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

// 1. 创建会话管理器
const sessionManager = new SessionManager({
  workspaceDir: "./workspace",
});

// 2. 创建 Agent 会话
const session = await createAgentSession({
  sessionManager,
  model: "anthropic/claude-sonnet-4-20250514",
  systemPrompt: "你是一个 helpful 的编程助手",
});

// 3. 运行对话
const result = await session.run("帮我创建一个 React 组件");
console.log(result);
```

---

## 三、必须保留的模块

### 3.1 核心 Agent 功能 (必须)

```
src/agents/
├── system-prompt.ts          # 系统 Prompt 构建
├── pi-tools.ts               # 工具创建和包装
├── tools/
│   ├── common.ts             # 工具基础类型
│   └── ...                   # 核心工具实现
├── skills/
│   ├── types.ts              # 技能类型定义
│   └── workspace.ts          # 工作区管理
└── subagent-registry.ts      # 子 Agent 注册
```

**原因**：这些是 OpenClaw 的核心智能层，直接与 pi-mono 交互。

### 3.2 配置系统 (必须)

```
src/config/
├── config.ts                 # 配置主入口
├── types.ts                  # 类型定义
├── types.openclaw.ts         # OpenClaw 配置结构
├── io.ts                     # 配置读写
└── validation.ts             # 配置验证
```

**原因**：简版仍需要配置模型、工具策略、Agent 设置等。

### 3.3 基础设施 (必须)

```
src/infra/
├── env.ts                    # 环境变量处理
├── errors.ts                 # 错误处理
├── dotenv.ts                 # .env 加载
└── is-main.ts                # 模块检测
```

**原因**：基础运行时依赖。

### 3.4 基础 CLI (必须)

```
src/cli/
├── program.ts                # CLI 入口
├── deps.ts                   # 依赖注入
└── prompt.ts                 # 交互提示
```

**原因**：简版至少需要一个基本的命令行界面。

---

## 四、可以省略的模块

### 4.1 Gateway Server (可省略)

```
src/gateway/
├── server.impl.ts            # WebSocket/HTTP 服务器
├── server-methods/           # API 方法实现
├── server-channels.ts        # 通道管理
├── server-plugins.ts         # 插件加载
└── ...
```

**省略原因**：
- 简版可以直接使用本地 Agent，不需要网络 API
- 不需要多客户端连接
- 不需要远程节点管理

**替代方案**：
```typescript
// 不使用 Gateway，直接使用 pi-coding-agent
const session = await createAgentSession({...});
```

### 4.2 消息通道 (可省略)

```
src/channels/
├── telegram/                 # Telegram Bot
├── discord/                  # Discord Bot
├── slack/                    # Slack Bot
├── whatsapp/                 # WhatsApp
└── plugins/                  # 通道插件系统

extensions/
├── telegram/                 # Telegram 扩展
├── discord/                  # Discord 扩展
├── slack/                    # Slack 扩展
├── whatsapp/                 # WhatsApp 扩展
├── voice-call/               # 语音通话
└── ...
```

**省略原因**：
- 简版可以只支持本地 CLI/TUI 交互
- 不需要多平台消息接入
- 不需要复杂的通道配置

**替代方案**：
```typescript
// 仅保留本地交互
import { runTui } from "./tui/tui.js";
await runTui({ url: "local", token: "" });
```

### 4.3 插件系统 (可简化)

```
src/plugins/
├── registry.ts               # 插件注册表
├── services.ts               # 插件服务
├── hook-runner*.ts           # Hook 系统
└── ...

extensions/                   # 所有扩展
```

**简化建议**：
- 保留技能系统（skills），但移除动态插件加载
- 将常用扩展内化为核心功能
- 移除复杂的插件生命周期管理

### 4.4 高级功能 (可省略)

| 功能 | 路径 | 省略理由 |
|------|------|----------|
| 浏览器控制 | `src/browser/`, `src/canvas-host/` | 非核心功能 |
| 语音通话 | `extensions/voice-call/` | 复杂度高，可选 |
| TTS/STT | `src/tts/` | 可选功能 |
| 内存系统 | `src/memory/` | 可由 pi-mono 替代 |
| Cron 任务 | `src/cron/` | 非核心功能 |
| 发现服务 | `src/discovery/` | 仅 Gateway 需要 |
| Tailscale | `src/tailscale/` | 网络功能可选 |
| 设备配对 | `extensions/device-pair/` | 可选功能 |

### 4.5 移动端应用 (可省略)

```
apps/
├── android/                  # Android 应用
├── ios/                      # iOS 应用
└── macos/                    # macOS 应用
```

**省略原因**：简版只关注核心 Agent 功能。

### 4.6 测试和文档 (可简化)

```
test/                         # 测试文件
docs/                         # 文档
scripts/                      # 构建脚本（保留核心）
```

---

## 五、简版架构建议

### 5.1 最小可行架构 (MVP)

```
mini-openclaw/
├── src/
│   ├── index.ts              # 入口
│   ├── cli/
│   │   ├── program.ts        # CLI 命令
│   │   └── prompt.ts         # 交互提示
│   ├── agents/
│   │   ├── system-prompt.ts  # 系统 Prompt
│   │   ├── pi-tools.ts       # 工具包装
│   │   └── tools/            # 核心工具
│   ├── config/
│   │   ├── config.ts         # 配置管理
│   │   └── types.openclaw.ts # 配置类型
│   ├── tui/                  # 可选：终端 UI
│   │   └── tui.ts
│   └── infra/                # 基础设施
│       └── env.ts
├── skills/                   # 技能目录（可选）
├── package.json
└── README.md
```

### 5.2 依赖精简

```json
{
  "dependencies": {
    "@mariozechner/pi-ai": "^0.53.0",
    "@mariozechner/pi-agent-core": "^0.53.0",
    "@mariozechner/pi-coding-agent": "^0.53.0",
    "@mariozechner/pi-tui": "^0.53.0",
    "commander": "^14.0.3",
    "chalk": "^5.6.2",
    "dotenv": "^17.3.1"
  }
}
```

### 5.3 核心代码示例

```typescript
// src/index.ts
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config/config.js";

async function main() {
  const config = loadConfig();
  
  const sessionManager = new SessionManager({
    workspaceDir: config.workspaceDir || "./workspace",
  });
  
  const session = await createAgentSession({
    sessionManager,
    model: config.models?.default || "anthropic/claude-sonnet-4-20250514",
    systemPrompt: buildSystemPrompt(config),
  });
  
  // 运行交互循环
  await runInteractiveLoop(session);
}

main().catch(console.error);
```

---

## 六、功能对比表

| 功能 | OpenClaw 完整版 | 简版 (pi-mono) | 说明 |
|------|----------------|----------------|------|
| **核心 Agent** | 是 | 是 | pi-coding-agent 提供 |
| **工具系统** | 完整 | 核心工具 | 保留 read/write/edit/exec |
| **多通道** | 10+ 通道 | 仅 CLI/TUI | 移除消息通道 |
| **Gateway API** | 完整 | 无 | 本地运行即可 |
| **插件系统** | 动态加载 | 内置技能 | 简化插件机制 |
| **浏览器控制** | 是 | 可选 | 非核心功能 |
| **语音通话** | 是 | 无 | 复杂功能 |
| **移动端** | Android/iOS | 无 | 仅桌面端 |
| **多节点** | 是 | 无 | 单机运行 |
| **配置系统** | 完整 | 简化 | 保留核心配置 |
| **技能系统** | 完整 | 简化 | 保留 SKILL.md |

---

## 七、实现建议

### 7.1 第一步：最小化启动

1. 创建新项目
2. 安装 `@mariozechner/pi-coding-agent`
3. 实现基本的 `createAgentSession` 调用
4. 添加简单的 CLI 交互

### 7.2 第二步：添加配置

1. 复制简化的配置类型
2. 实现配置加载/保存
3. 支持模型选择和 API Key 设置

### 7.3 第三步：添加工具

1. 使用 pi-coding-agent 内置工具
2. 根据需要添加自定义工具
3. 实现工具策略配置

### 7.4 第四步：可选功能

1. 添加 TUI 界面（使用 pi-tui）
2. 添加技能系统
3. 添加会话持久化

---

## 八、参考文档

- [pi-mono 文档](https://github.com/mariozechner/pi-mono)
- [OpenClaw 架构文档](./architecture_analysis.md)
- [Prompt 研究文档](./prompts_research.md)

---

## 九、总结

**必须保留**：
- pi-mono 核心依赖（pi-ai, pi-agent-core, pi-coding-agent）
- 基础配置系统
- 简化的 CLI/TUI
- 核心工具系统

**可以省略**：
- Gateway Server
- 消息通道（Telegram/Discord/Slack 等）
- 复杂的插件系统
- 浏览器控制
- 语音通话
- 移动端应用
- 多节点支持

**简版的核心价值**：
保留 "文件即上下文" 和 "强工具执行力" 的核心体验，去除复杂的服务器架构和多平台支持，专注于本地开发助手场景。
