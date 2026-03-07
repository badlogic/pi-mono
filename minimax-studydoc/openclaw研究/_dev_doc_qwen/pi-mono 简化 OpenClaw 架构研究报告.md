# 使用 pi-mono 构建简版 OpenClaw 架构研究报告

**日期**: 2026 年 2 月 18 日  
**目标**: 分析如何利用 pi-mono 项目创建一个精简版的 OpenClaw，只保留核心必要功能

---

## 1. 执行摘要

### 1.1 核心发现

OpenClaw 当前已经深度集成了 Mario Zechner 的 `pi-mono` 项目组件：

```json
{
  "@mariozechner/pi-agent-core": "0.53.0",
  "@mariozechner/pi-ai": "0.53.0",
  "@mariozechner/pi-coding-agent": "0.53.0",
  "@mariozechner/pi-tui": "0.53.0"
}
```

**关键洞察**：OpenClaw 本质上已经是基于 pi-mono 构建的生产级扩展。创建"简版 OpenClaw"的最佳策略是**剥离扩展层，回归 pi-mono 核心**，而非重新构建。

### 1.2 建议架构

```
┌─────────────────────────────────────────────────────────┐
│                    简版 OpenClaw                         │
├─────────────────────────────────────────────────────────┤
│  CLI (Commander)  │  Gateway (WebSocket) │  Config     │
├─────────────────────────────────────────────────────────┤
│              pi-embedded-runner (适配层)                 │
├─────────────────────────────────────────────────────────┤
│    pi-agent-core    │    pi-ai (LLM 抽象)               │
└─────────────────────────────────────────────────────────┘
         │                    │
    ┌────┴────┐          ┌────┴────┐
    │ Tools   │          │  Models │
    │ - Bash  │          │ - Anthropic │
    │ - Read  │          │ - OpenAI    │
    │ - Write │          │ - Gemini    │
    └─────────┘          └───────────┘
```

---

## 2. pi-mono 项目分析

### 2.1 项目概述

**pi-mono** 是一个 monorepo 项目，提供：
- 统一的 LLM API 抽象层 (`pi-ai`)
- 代理运行时框架 (`pi-agent-core`)
- 交互式编码代理 CLI (`pi-coding-agent`)
- 终端 UI 库 (`pi-tui`)
- Slack 机器人集成 (`pi-mom`)
- vLLM 部署管理 (`pi-pods`)

**仓库**: https://github.com/badlogic/pi-mono  
**License**: MIT  
**最新**: v0.53.0

### 2.2 核心包结构

| 包名 | 功能 | 依赖 |
|------|------|------|
| `@mariozechner/pi-ai` | 统一多提供商 LLM API（OpenAI、Anthropic、Google 等） | 无 |
| `@mariozechner/pi-agent-core` | 代理运行时，工具调用，状态管理 | pi-ai |
| `@mariozechner/pi-coding-agent` | 交互式编码代理 CLI | pi-agent-core, pi-ai |
| `@mariozechner/pi-tui` | 终端 UI 库（差异渲染） | 无 |
| `@mariozechner/pi-web-ui` | Web 聊天界面组件 | pi-ai |

### 2.3 pi-agent-core 架构

```
pi-agent-core/
├── session-manager.ts    # 会话状态管理
├── model-config.ts       # 模型配置
├── model-resolver.ts     # 模型解析
├── system-prompt.ts      # 系统提示生成
├── tools/                # 工具系统
│   ├── tool-registry.ts
│   ├── tool-executor.ts
│   └── ...
└── agent-loop.ts         # 代理主循环
```

**核心循环**:
```typescript
async function agentLoop(messages, tools, model) {
  const response = await model.chat(messages, tools);
  
  for (const toolCall of response.toolCalls) {
    const result = await tools.execute(toolCall);
    messages.push({ role: "tool", content: result });
  }
  
  messages.push(response.assistantMessage);
  
  if (response.needsMoreTurns) {
    return agentLoop(messages, tools, model);
  }
  
  return response;
}
```

---

## 3. OpenClaw 当前架构分析

### 3.1 完整架构层次

```
┌─────────────────────────────────────────────────────────────┐
│                      客户端层                                │
│  macOS App │ iOS App │ Android App │ Web UI │ CLI          │
├─────────────────────────────────────────────────────────────┤
│                      网关层 (Gateway)                        │
│  WebSocket 控制平面 │ 渠道管理 │ 会话管理 │ 插件系统        │
├─────────────────────────────────────────────────────────────┤
│                      渠道层 (Channels)                       │
│  WhatsApp │ Telegram │ Slack │ Discord │ Signal │ iMessage  │
│  Teams │ Matrix │ Zalo │ Google Chat │ WebChat             │
├─────────────────────────────────────────────────────────────┤
│                      代理层 (Agents)                         │
│  pi-embedded-runner │ 工具系统 │ 技能系统 │ 沙箱            │
├─────────────────────────────────────────────────────────────┤
│                      核心层 (Core)                           │
│  pi-agent-core │ pi-ai │ 配置系统 │ 日志系统                │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心源代码结构 (src/)

```
src/
├── agents/           # AI 代理运行时 (~150 个文件)
│   ├── pi-embedded-runner.ts    # pi-agent 嵌入层
│   ├── pi-embedded-subscribe.ts # 事件订阅
│   ├── tools/        # 工具实现
│   ├── sandbox/      # 沙箱执行
│   └── skills/       # 技能系统
├── gateway/          # WebSocket 网关 (~50 个文件)
│   ├── server.impl.ts  # 网关服务器
│   ├── server-channels.ts # 渠道管理
│   ├── server-methods/    # WS 方法处理
│   └── ...
├── channels/         # 渠道集成 (~15 个目录)
│   ├── whatsapp/
│   ├── telegram/
│   ├── discord/
│   └── ...
├── cli/              # CLI 命令 (~30 个文件)
│   ├── program.ts
│   ├── commands/
│   └── ...
├── config/           # 配置系统
│   ├── config.ts
│   ├── types.ts
│   └── validation.ts
├── plugins/          # 插件系统
├── tools/            # 工具定义
├── sessions/         # 会话管理
├── media/            # 媒体处理
├── browser/          # 浏览器控制
├── canvas-host/      # Canvas 主机
├── cron/             # 定时任务
├── web/              # Web 界面
└── wizard/           # 配置向导
```

### 3.3 关键依赖关系

**pi-embedded-runner 核心流程**:

```typescript
// src/agents/pi-embedded-runner/run.ts (简化)
export async function runEmbeddedPiAgent(params) {
  // 1. 解析模型和认证
  const { model, apiKey } = await resolveModel(params);
  
  // 2. 构建系统提示
  const systemPrompt = await createSystemPromptOverride(params);
  
  // 3. 准备工具
  const { coreTools, appTools } = splitSdkTools(params);
  
  // 4. 构建沙箱信息
  const sandboxInfo = await buildEmbeddedSandboxInfo(params);
  
  // 5. 执行代理循环
  const result = await runEmbeddedAttempt({
    model,
    apiKey,
    systemPrompt,
    tools: coreTools,
    messages: sanitizeMessages(params.history),
    sandboxInfo,
  });
  
  // 6. 处理结果（流式/块式）
  return streamResultToSubscriber(result, params.session);
}
```

---

## 4. 简化策略

### 4.1 功能优先级矩阵

| 功能模块 | 核心性 | 复杂度 | 保留建议 |
|----------|--------|--------|----------|
| **pi-agent-core 运行时** | ⭐⭐⭐⭐⭐ | 低 | **必须保留** |
| **pi-ai LLM 抽象** | ⭐⭐⭐⭐⭐ | 低 | **必须保留** |
| **基础工具 (Bash/Read/Write)** | ⭐⭐⭐⭐⭐ | 中 | **必须保留** |
| **会话管理** | ⭐⭐⭐⭐ | 中 | **简化保留** |
| **配置系统** | ⭐⭐⭐⭐ | 低 | **简化保留** |
| **CLI 入口** | ⭐⭐⭐⭐ | 低 | **必须保留** |
| **Gateway WebSocket** | ⭐⭐⭐ | 高 | **可选（单用户可移除）** |
| **渠道集成 (WhatsApp 等)** | ⭐⭐⭐ | 高 | **按需选择 1-2 个** |
| **插件系统** | ⭐⭐ | 高 | **移除** |
| **技能系统** | ⭐⭐ | 高 | **移除** |
| **沙箱执行** | ⭐⭐ | 高 | **移除（信任模式）** |
| **Canvas 主机** | ⭐ | 高 | **移除** |
| **浏览器控制** | ⭐⭐ | 中 | **可选** |
| **多代理/子代理** | ⭐ | 高 | **移除** |
| **移动应用 (iOS/Android)** | ⭐ | 极高 | **移除** |
| **macOS 应用** | ⭐ | 极高 | **移除** |

### 4.2 简化架构图

```
┌─────────────────────────────────────────────────────┐
│                  简版 OpenClaw                       │
├─────────────────────────────────────────────────────┤
│  CLI (Commander)  │  配置 (JSON + .env)             │
├─────────────────────────────────────────────────────┤
│           pi-embedded-runner (精简版)                │
│   - 模型解析     - 系统提示生成                       │
│   - 工具执行     - 会话历史管理                       │
├─────────────────────────────────────────────────────┤
│    pi-agent-core    │    pi-ai                      │
├─────────────────────────────────────────────────────┤
│  核心工具集：                                        │
│  - bash (执行命令)                                   │
│  - read (读取文件)                                   │
│  - write (写入文件)                                  │
│  - edit (编辑文件)                                   │
│  - glob (文件搜索)                                   │
└─────────────────────────────────────────────────────┘
```

### 4.3 代码量对比

| 组件 | 原始 OpenClaw | 简版目标 | 减少比例 |
|------|---------------|----------|----------|
| `src/agents/` | ~150 文件 | ~20 文件 | -87% |
| `src/gateway/` | ~50 文件 | 0 文件 | -100% |
| `src/channels/` | ~15 目录 | 0 目录 | -100% |
| `src/cli/` | ~30 文件 | ~10 文件 | -67% |
| `src/plugins/` | ~20 文件 | 0 文件 | -100% |
| `src/skills/` | ~30 文件 | 0 文件 | -100% |
| **总计** | **~500+ 文件** | **~50 文件** | **-90%** |

---

## 5. 实现方案

### 5.1 阶段一：提取核心代理运行时

**目标文件** (`src/agents/` 精简):

```
agents-lite/
├── index.ts              # 导出核心 API
├── runner.ts             # 简化的 runEmbeddedPiAgent
├── model.ts              # 模型解析（基于 model-auth.ts）
├── system-prompt.ts      # 系统提示生成
├── tools/
│   ├── bash.ts           # Bash 执行
│   ├── read.ts           # 文件读取
│   ├── write.ts          # 文件写入
│   └── glob.ts           # 文件搜索
├── session.ts            # 简化会话管理
└── types.ts              # 类型定义
```

**核心 runner 实现** (约 200 行):

```typescript
// agents-lite/runner.ts
import { Agent, type AgentConfig } from "@mariozechner/pi-agent-core";
import { createLLM } from "@mariozechner/pi-ai";
import { executeBash } from "./tools/bash.js";
import { readFile } from "./tools/read.js";
import { writeFile } from "./tools/write.js";
import { globFiles } from "./tools/glob.js";

export type LiteAgentConfig = {
  model: string;
  apiKey?: string;
  provider?: string;
  workspace: string;
  systemPrompt?: string;
};

export async function runLiteAgent(
  userMessage: string,
  config: LiteAgentConfig,
  history: Array<{ role: string; content: string }> = []
) {
  // 1. 初始化 LLM
  const llm = createLLM({
    provider: config.provider || "anthropic",
    apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    model: config.model,
  });
  
  // 2. 注册工具
  const tools = {
    bash: executeBash,
    read: readFile,
    write: writeFile,
    glob: globFiles,
  };
  
  // 3. 构建系统提示
  const systemPrompt = config.systemPrompt || buildDefaultSystemPrompt(tools);
  
  // 4. 创建代理实例
  const agent = new Agent({
    llm,
    tools,
    systemPrompt,
    workspace: config.workspace,
  });
  
  // 5. 执行代理循环
  const result = await agent.run({
    messages: [...history, { role: "user", content: userMessage }],
  });
  
  return {
    response: result.assistantMessage,
    toolCalls: result.toolCalls,
    usage: result.usage,
  };
}

function buildDefaultSystemPrompt(tools: object): string {
  const toolList = Object.keys(tools).join(", ");
  return `You are a helpful coding assistant.
Available tools: ${toolList}.
Read files before editing.
Test changes by running commands.
`;
}
```

### 5.2 阶段二：简化 CLI

**目标结构** (`cli-lite/`):

```
cli-lite/
├── index.ts              # CLI 入口
├── commands/
│   ├── agent.ts          # agent 命令
│   ├── config.ts         # config 命令
│   └── init.ts           # init 命令
└── config.ts             # CLI 配置
```

**CLI 入口** (约 100 行):

```typescript
// cli-lite/index.ts
#!/usr/bin/env node
import { Command } from "commander";
import { runLiteAgent } from "../agents-lite/runner.js";
import { loadConfig, saveConfig } from "./config.js";

const program = new Command();

program
  .name("openclaw-lite")
  .description("简版 OpenClaw - 个人 AI 编码助手")
  .version("0.1.0");

program
  .command("agent")
  .description("运行 AI 代理")
  .argument("<message>", "用户消息")
  .option("-m, --model <model>", "模型名称", "claude-opus-4-6")
  .option("-w, --workspace <dir>", "工作目录", process.cwd())
  .option("-c, --config <path>", "配置文件路径", "~/.openclaw-lite/config.json")
  .action(async (message, options) => {
    const config = await loadConfig(options.config);
    
    const result = await runLiteAgent(message, {
      model: options.model,
      workspace: options.workspace,
      apiKey: config.apiKey,
      provider: config.provider,
    });
    
    console.log(result.response.content);
  });

program
  .command("config")
  .description("配置管理")
  .option("--set <key=value>", "设置配置项")
  .option("--get <key>", "获取配置项")
  .option("--show", "显示所有配置")
  .action(async (options) => {
    // 配置管理逻辑
  });

program
  .command("init")
  .description("初始化配置")
  .action(async () => {
    // 交互式配置向导
  });

program.parse();
```

### 5.3 阶段三：配置文件简化

**原始配置** (`~/.openclaw/openclaw.json`):
```json5
{
  "agent": {
    "model": "anthropic/claude-opus-4-6",
    "defaults": {
      "workspace": "~/.openclaw/workspace",
      "sandbox": { "mode": "non-main" },
      // ... 50+ 配置项
    }
  },
  "gateway": {
    "bind": "loopback",
    "port": 18789,
    "auth": { "mode": "token" },
    "controlUi": { "enabled": true },
    // ... 30+ 配置项
  },
  "channels": {
    "whatsapp": { /* ... */ },
    "telegram": { /* ... */ },
    // ... 10+ 渠道
  },
  "plugins": { /* ... */ },
  "skills": { /* ... */ },
  // ... 总计 200+ 配置键
}
```

**简化配置** (`~/.openclaw-lite/config.json`):
```json5
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",  // 或使用环境变量
  "model": "claude-opus-4-6",
  "workspace": "~/.openclaw-lite/workspace"
}
```

### 5.4 阶段四：移除网关层（可选）

对于单用户场景，可以完全移除 Gateway WebSocket 层：

**移除的模块**:
- `src/gateway/` (50+ 文件)
- `src/channels/` (渠道集成)
- `src/web/` (Web 界面)
- `src/canvas-host/` (Canvas 服务)
- `src/cron/` (定时任务)
- `src/plugins/` (插件系统)

**保留的模块**:
- `src/agents/` (精简版)
- `src/cli/` (精简版)
- `src/config/` (精简版)
- `src/process/` (进程执行)

---

## 6. 依赖精简

### 6.1 原始依赖 (package.json)

```json
{
  "dependencies": {
    "@mariozechner/pi-agent-core": "0.53.0",
    "@mariozechner/pi-ai": "0.53.0",
    "@mariozechner/pi-coding-agent": "0.53.0",
    "@mariozechner/pi-tui": "0.53.0",
    "@whiskeysockets/baileys": "7.0.0-rc.9",  // WhatsApp
    "grammy": "^1.40.0",                       // Telegram
    "@slack/bolt": "^4.6.0",                   // Slack
    "discord.js": "...",                       // Discord
    "signal-utils": "^0.21.1",                 // Signal
    // ... 总计 80+ 依赖
  }
}
```

### 6.2 简化依赖

```json
{
  "name": "openclaw-lite",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@mariozechner/pi-agent-core": "0.53.0",
    "@mariozechner/pi-ai": "0.53.0",
    "commander": "^14.0.3",
    "chalk": "^5.6.2",
    "dotenv": "^17.3.1"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "tsx": "^4.21.0",
    "vitest": "^4.0.18"
  }
}
```

**依赖减少**: 80+ → 8 个 (-90%)

---

## 7. 构建与运行

### 7.1 项目结构

```
openclaw-lite/
├── package.json
├── tsconfig.json
├── src/
│   ├── agents-lite/
│   │   ├── index.ts
│   │   ├── runner.ts
│   │   ├── model.ts
│   │   ├── system-prompt.ts
│   │   ├── session.ts
│   │   ├── types.ts
│   │   └── tools/
│   │       ├── bash.ts
│   │       ├── read.ts
│   │       ├── write.ts
│   │       └── glob.ts
│   └── cli-lite/
│       ├── index.ts
│       ├── config.ts
│       └── commands/
│           ├── agent.ts
│           ├── config.ts
│           └── init.ts
└── README.md
```

### 7.2 构建命令

```bash
# 安装依赖
pnpm install

# 类型检查
pnpm tsgo

# 构建
pnpm build  # tsdown 或 tsc

# 运行
pnpm openclaw-lite agent "为项目添加单元测试"

# 开发模式
pnpm dev
```

### 7.3 使用示例

```bash
# 初始化配置
openclaw-lite init

# 运行代理
openclaw-lite agent "创建一个 Express.js 服务器"

# 指定模型
openclaw-lite agent "重构这个函数" --model claude-sonnet-4-6

# 指定工作目录
openclaw-lite agent "添加日志功能" --workspace /path/to/project
```

---

## 8. 功能对比

| 功能 | 完整 OpenClaw | 简版 OpenClaw |
|------|---------------|---------------|
| **核心代理** | ✅ | ✅ |
| **多模型支持** | ✅ (20+ 提供商) | ✅ (Anthropic/OpenAI/Google) |
| **工具执行** | ✅ (50+ 工具) | ✅ (4 核心工具) |
| **会话管理** | ✅ (多会话/群组) | ✅ (单会话) |
| **CLI** | ✅ (30+ 命令) | ✅ (3 命令) |
| **配置向导** | ✅ | ✅ (简化版) |
| **WebSocket 网关** | ✅ | ❌ |
| **消息渠道** | ✅ (15+ 渠道) | ❌ |
| **插件系统** | ✅ | ❌ |
| **技能系统** | ✅ | ❌ |
| **沙箱执行** | ✅ (Docker) | ❌ (信任模式) |
| **Canvas** | ✅ | ❌ |
| **浏览器控制** | ✅ | ❌ |
| **多代理** | ✅ | ❌ |
| **macOS 应用** | ✅ | ❌ |
| **iOS/Android** | ✅ | ❌ |
| **Web 界面** | ✅ | ❌ |
| **定时任务** | ✅ | ❌ |
| **代码量** | ~50,000 行 | ~5,000 行 |
| **依赖** | 80+ | 8 个 |
| **配置文件** | 200+ 键 | 5 键 |

---

## 9. 实施路线图

### 阶段 1：核心提取 (1-2 周)
- [ ] 提取 `pi-embedded-runner` 核心逻辑
- [ ] 简化模型解析和认证
- [ ] 实现 4 个核心工具 (bash/read/write/glob)
- [ ] 创建基础会话管理

### 阶段 2：CLI 构建 (1 周)
- [ ] 使用 Commander 构建 CLI 框架
- [ ] 实现 `agent` 命令
- [ ] 实现 `config` 命令
- [ ] 实现 `init` 命令

### 阶段 3：配置系统 (3-5 天)
- [ ] 简化配置文件格式
- [ ] 实现配置加载/保存
- [ ] 实现配置验证

### 阶段 4：测试与文档 (1 周)
- [ ] 编写单元测试
- [ ] 编写 E2E 测试
- [ ] 编写 README 和使用文档

### 阶段 5：发布准备 (3-5 天)
- [ ] 打包发布
- [ ] npm 发布
- [ ] 文档站点

**总预计时间**: 4-6 周

---

## 10. 风险与挑战

### 10.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| pi-mono API 变更 | 高 | 锁定版本 0.53.0，监控更新 |
| 工具执行安全 | 中 | 添加命令白名单，用户确认 |
| 会话持久化 | 低 | 使用简单 JSON 存储 |
| 错误处理 | 中 | 保留核心错误处理逻辑 |

### 10.2 功能取舍

**移除的功能理由**:

1. **网关层**: 单用户场景不需要 WebSocket 控制平面
2. **渠道集成**: 专注编码助手定位，消息渠道是扩展功能
3. **插件/技能**: 增加复杂度，核心 4 工具已足够
4. **沙箱**: 个人使用场景信任级别高，Docker 增加部署复杂度
5. **Canvas/浏览器**: 高级功能，可在后续版本添加

### 10.3 向后兼容

简版与完整版的兼容性：

| 方面 | 兼容性 | 说明 |
|------|--------|------|
| 配置文件 | ❌ | 格式完全不同 |
| 会话数据 | ⚠️ | 可读取但会忽略扩展字段 |
| 工作空间 | ✅ | 相同目录结构 |
| API 密钥 | ✅ | 使用相同环境变量 |

---

## 11. 结论与建议

### 11.1 核心结论

1. **OpenClaw 已是 pi-mono 的生产级扩展**，创建简版的本质是"做减法"
2. **核心代理运行时仅依赖 pi-agent-core + pi-ai**，其他都是扩展层
3. **90% 的代码量可以移除**，同时保留核心编码助手功能
4. **最佳策略**: 创建独立的 `openclaw-lite` 包，而非修改现有代码

### 11.2 建议架构决策

```
推荐：创建独立项目
├── openclaw-lite/          # 新项目，从零构建
│   ├── 基于 pi-mono 核心
│   ├── 只保留必要功能
│   └── 独立发布和维护

不推荐：从 OpenClaw 剥离
├── openclaw/
│   ├── 大量遗留代码
│   ├── 复杂的依赖关系
│   └── 难以维护两个版本
```

### 11.3 下一步行动

1. **验证概念**: 用 1-2 天创建最小可行原型 (MVP)
2. **用户调研**: 确认简版功能集是否符合目标用户需求
3. **技术验证**: 测试 pi-mono 在简化场景下的稳定性
4. **决策**: 基于 MVP 反馈决定是否继续开发

---

## 附录 A: pi-mono 关键文件参考

### A.1 pi-agent-core 核心接口

```typescript
// @mariozechner/pi-agent-core
export interface Agent {
  run(params: RunParams): Promise<RunResult>;
  subscribe(events: EventHandler): void;
}

export interface RunParams {
  messages: Message[];
  tools: ToolRegistry;
  systemPrompt?: string;
}

export interface RunResult {
  assistantMessage: Message;
  toolCalls: ToolCall[];
  usage: Usage;
}
```

### A.2 pi-ai 提供商支持

```typescript
// @mariozechner/pi-ai
export type Provider = 
  | "anthropic"
  | "openai"
  | "google"
  | "ollama"
  | "openrouter"
  | "groq"
  | "xai";

export function createLLM(config: LLMConfig): LLM;
```

### A.3 系统提示模板

```typescript
// pi-mono/packages/coding-agent/src/core/system-prompt.ts
export function buildSystemPrompt(tools: Tool[]): string {
  return `You help users by reading files, executing commands, 
editing code, and writing new files. 
Available tools: ${tools.map(t => t.name).join(", ")}.`;
}
```

---

## 附录 B: OpenClaw 关键文件映射

| OpenClaw 文件 | 功能 | 简版处理 |
|---------------|------|----------|
| `src/agents/pi-embedded-runner.ts` | 代理运行核心 | 精简保留 |
| `src/agents/pi-embedded-subscribe.ts` | 事件订阅 | 移除 |
| `src/gateway/server.impl.ts` | 网关服务器 | 移除 |
| `src/cli/program.ts` | CLI 入口 | 精简保留 |
| `src/config/config.ts` | 配置加载 | 精简保留 |
| `src/channels/*/` | 渠道集成 | 全部移除 |
| `src/plugins/` | 插件系统 | 全部移除 |
| `src/skills/` | 技能系统 | 全部移除 |

---

## 附录 C: 参考资源

- **pi-mono**: https://github.com/badlogic/pi-mono
- **OpenClaw**: https://github.com/openclaw/openclaw
- **pi-ai npm**: https://www.npmjs.com/package/@mariozechner/pi-ai
- **pi-agent-core npm**: https://www.npmjs.com/package/@mariozechner/pi-agent-core
- **OpenClaw 文档**: https://docs.openclaw.ai
- **架构分析文章**: 
  - https://zhuanlan.zhihu.com/p/2003914477209413004
  - https://medium.com/@shivam.agarwal.in/agentic-ai-pi-anatomy-of-a-minimal-coding-agent-powering-openclaw-5ecd4dd6b440

---

**报告完成时间**: 2026 年 2 月 18 日  
**作者**: Qwen Code  
**版本**: 1.0
