# Mini OpenClaw 能否实现语音故事场景？

> 分析基于 pi-mono 的简版 OpenClaw 是否能实现 Peter Steinberger 故事中的自主语音处理能力

---

## 一、故事场景回顾

**Agent 需要完成的自主链路**:
1. 接收无扩展名的文件链接
2. 检测文件头识别为 Opus 音频格式
3. 使用 FFmpeg 将 Opus 转为 Wave
4. 尝试 Whisper 本地转写（失败）
5. 检查环境变量发现 OpenAI API Key
6. 使用 curl 调用 OpenAI API 完成转写
7. 基于转写内容回复

---

## 二、Mini OpenClaw 的能力分析

### 2.1 原版 Mini OpenClaw 设计（来自 mini_openclaw_guide.md）

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

**核心依赖**:
- `@mariozechner/pi-ai` - LLM 抽象
- `@mariozechner/pi-agent-core` - Agent 循环
- `@mariozechner/pi-coding-agent` - 高级 SDK
- `@mariozechner/pi-tui` - 终端 UI

---

## 三、能力对照分析

### 3.1 故事需求 vs Mini OpenClaw 能力

| 故事步骤 | 所需能力 | Mini版现状 | 是否支持 |
|----------|----------|------------|----------|
| 1. 接收文件 | 文件输入处理 | ✅ 基础文件读取 | **是** |
| 2. 检测文件头 | MIME类型识别 | ❌ 无 `file-type` 库 | **否** |
| 3. FFmpeg转码 | Shell执行 | ⚠️ 需额外实现 exec 工具 | **需添加** |
| 4. Whisper转写 | 本地命令执行 | ⚠️ 依赖 exec 工具 | **需添加** |
| 5. 检查环境变量 | 环境变量读取 | ✅ Node.js 原生支持 | **是** |
| 6. curl调用API | HTTP请求/Shell | ⚠️ 需 web-fetch 或 exec | **需添加** |
| 7. 回复用户 | 文本生成 | ✅ pi-coding-agent 支持 | **是** |

---

### 3.2 关键缺失能力

#### ❌ 1. 文件类型检测（MIME Sniffing）

**OpenClaw 完整实现**:
```typescript
// src/media/mime.ts
import { fileTypeFromBuffer } from "file-type";

export async function detectMime(opts: {
  buffer?: Buffer;
  filePath?: string;
}): Promise<string | undefined> {
  const sniffed = await sniffMime(opts.buffer);  // 通过文件头识别
  const extMime = ext ? MIME_BY_EXT[ext] : undefined;
  
  if (sniffed && (!isGenericMime(sniffed) || !extMime)) {
    return sniffed;  // 优先使用 sniffed 类型
  }
  // ...
}
```

**Mini版需要添加**:
```typescript
// 新增: src/media/mime.ts
import { fileTypeFromBuffer } from "file-type";

export async function detectMime(buffer: Buffer): Promise<string | undefined> {
  const type = await fileTypeFromBuffer(buffer);
  return type?.mime;
}
```

**依赖**: `file-type` 包

---

#### ⚠️ 2. Shell 执行工具（Exec Tool）

**OpenClaw 完整实现**:
```typescript
// src/agents/bash-tools.exec.ts
export function createExecTool(defaults?: ExecToolDefaults): AgentTool {
  return {
    name: "exec",
    description: "Execute shell commands...",
    parameters: execSchema,
    execute: async (_toolCallId, args, signal, onUpdate) => {
      // 复杂的执行逻辑：sandbox/gateway/node 支持
      // 权限控制、超时管理、输出截断
    }
  };
}
```

**Mini版简化实现**:
```typescript
// 新增: src/agents/tools/exec-tool.ts
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export function createSimpleExecTool(): AgentTool {
  return {
    name: "exec",
    description: "Execute shell commands (ffmpeg, curl, etc.)",
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    execute: async (_id, args) => {
      const { stdout, stderr } = await execAsync(args.command, {
        timeout: args.timeout || 60000,
      });
      return {
        content: [{ type: "text", text: stdout || stderr }],
      };
    },
  };
}
```

**注意**: 完整版有复杂的安全控制（sandbox、权限验证），Mini版需要权衡安全性。

---

#### ⚠️ 3. Web 请求工具（Web Fetch）

**故事中的 curl 调用**:
```bash
curl -X POST https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file=@output.wav \
  -F model=whisper-1
```

**Mini版需要添加**:
```typescript
// 新增: src/agents/tools/web-fetch.ts
export function createWebFetchTool(): AgentTool {
  return {
    name: "web_fetch",
    description: "Make HTTP requests to APIs",
    parameters: Type.Object({
      url: Type.String(),
      method: Type.Optional(Type.String()),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
      body: Type.Optional(Type.String()),
    }),
    execute: async (_id, args) => {
      const response = await fetch(args.url, {
        method: args.method || "GET",
        headers: args.headers,
        body: args.body,
      });
      const text = await response.text();
      return {
        content: [{ type: "text", text }],
      };
    },
  };
}
```

---

#### ⚠️ 4. 音频处理工具（可选）

**完整版有专门的音频处理**:
```typescript
// src/media-understanding/providers/openai/audio.ts
export async function transcribeOpenAiCompatibleAudio(
  params: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResult> {
  // 专业的音频转写实现
}
```

**Mini版替代方案**:
- 通过 `exec` 工具调用 FFmpeg + curl 组合完成
- 或添加简单的音频转写工具封装

---

## 四、Mini版需要添加的模块

### 4.1 必须添加

```
mini-openclaw/
├── src/
│   ├── media/
│   │   └── mime.ts           # 文件类型检测 (新增)
│   └── agents/
│       └── tools/
│           ├── exec-tool.ts  # Shell执行 (新增)
│           └── web-fetch.ts  # HTTP请求 (新增)
```

### 4.2 依赖添加

```json
{
  "dependencies": {
    "@mariozechner/pi-ai": "^0.53.0",
    "@mariozechner/pi-agent-core": "^0.53.0",
    "@mariozechner/pi-coding-agent": "^0.53.0",
    "file-type": "^19.0.0",           // 新增: 文件类型检测
    "commander": "^14.0.3",
    "chalk": "^5.6.2"
  }
}
```

---

## 五、实现后的能力验证

### 5.1 故事场景复现

添加必要模块后，Mini OpenClaw 可以完成：

```typescript
// Agent 自主决策链路

// 1. 接收文件 -> 检测类型
const fileBuffer = await fs.readFile(filePath);
const mimeType = await detectMime(fileBuffer);
// mimeType = "audio/opus"

// 2. FFmpeg 转码
await execTool.execute(null, {
  command: `ffmpeg -i ${filePath} output.wav`
});

// 3. 尝试 Whisper（失败）
try {
  await execTool.execute(null, {
    command: `whisper output.wav`
  });
} catch (e) {
  // 失败，继续下一步
}

// 4. 检查环境变量
const apiKey = process.env.OPENAI_API_KEY;
if (apiKey) {
  // 5. 调用 OpenAI API
  await webFetchTool.execute(null, {
    url: "https://api.openai.com/v1/audio/transcriptions",
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`
    },
    // ... form data
  });
}

// 6. 基于转写结果回复
```

### 5.2 能力对比表

| 能力维度 | 完整版 OpenClaw | Mini版（添加后） | 差距 |
|----------|----------------|-----------------|------|
| 文件类型检测 | ✅ 完整 MIME 支持 | ✅ 基础检测 | 无差距 |
| Shell执行 | ✅ Sandbox/权限控制 | ⚠️ 基础执行 | 安全性简化 |
| HTTP请求 | ✅ 完整 web-fetch | ✅ 基础 fetch | 功能足够 |
| 音频处理 | ✅ 专业封装 | ⚠️ 命令组合 | 可用但粗糙 |
| 环境感知 | ✅ 完整 | ✅ 完整 | 无差距 |
| 错误回退 | ✅ 完善 | ✅ 基础 | 核心能力保留 |

---

## 六、关键结论

### 6.1 核心问题：Mini版**能**做到吗？

**答案：可以，但需要添加关键工具**

原版 Mini OpenClaw 设计过于简化，缺少：
1. **文件类型检测** - 无法识别无扩展名文件
2. **Shell 执行** - 无法调用 FFmpeg、curl
3. **HTTP 请求** - 无法调用 API

### 6.2 最小添加清单

| 优先级 | 模块 | 依赖 | 代码量 |
|--------|------|------|--------|
| P0 | `file-type` 文件检测 | `file-type` | ~50行 |
| P0 | `exec` 工具 | Node.js 内置 | ~100行 |
| P0 | `web_fetch` 工具 | Node.js 内置 | ~50行 |
| P1 | 音频转写封装 | 无 | ~100行 |

### 6.3 与完整版的核心差距

| 维度 | 完整版 | Mini版（增强后） |
|------|--------|-----------------|
| **安全性** | Sandbox、权限控制、命令白名单 | 基础执行，依赖用户信任 |
| **健壮性** | 超时、重试、输出截断、错误恢复 | 基础实现 |
| **功能广度** | 浏览器、TTS、内存系统等 | 核心工具 only |
| **架构复杂度** | Gateway、多节点、插件系统 | 单进程本地运行 |

### 6.4 设计权衡建议

**如果追求"足智多谋的野兽"体验**：

```
推荐方案: Mini版 + 关键工具增强

保留:
- 核心 Agent 循环 (pi-coding-agent)
- 文件操作工具
- Shell 执行工具 (简化版)
- Web 请求工具
- 文件类型检测

省略:
- Gateway Server
- 消息通道
- 复杂插件系统
- 浏览器控制
- 语音通话
```

**关键洞察**：
- 故事的核心不是**功能多**，而是**Agent 能自主组合已有工具解决问题**
- Mini版只要保留 **Shell + Web + 文件** 三大能力，就能实现类似体验
- 安全性可以通过"本地运行 + 用户确认"来简化

---

## 七、参考实现代码

### 7.1 增强版 Mini OpenClaw 结构

```
mini-openclaw-enhanced/
├── src/
│   ├── index.ts
│   ├── cli/
│   │   └── program.ts
│   ├── agents/
│   │   ├── system-prompt.ts
│   │   ├── pi-tools.ts
│   │   └── tools/
│   │       ├── read-tool.ts
│   │       ├── write-tool.ts
│   │       ├── edit-tool.ts
│   │       ├── exec-tool.ts      # 新增: Shell执行
│   │       └── web-fetch.ts      # 新增: HTTP请求
│   ├── media/
│   │   └── mime.ts               # 新增: 文件类型检测
│   └── config/
│       └── config.ts
├── package.json
└── README.md
```

### 7.2 核心代码片段

```typescript
// src/agents/tools/exec-tool.ts
import { exec } from "child_process";
import { promisify } from "util";
import { Type } from "@sinclair/typebox";

const execAsync = promisify(exec);

export function createExecTool(): AgentTool {
  return {
    name: "exec",
    label: "Exec",
    description: "Execute shell commands (ffmpeg, curl, git, etc.)",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds" })),
    }),
    execute: async (_toolCallId, args) => {
      const { stdout, stderr } = await execAsync(args.command, {
        timeout: args.timeout || 60000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return {
        content: [{ type: "text", text: stdout || stderr }],
        details: { command: args.command },
      };
    },
  };
}
```

```typescript
// src/media/mime.ts
import { fileTypeFromBuffer } from "file-type";

export async function detectMime(buffer: Buffer): Promise<string | undefined> {
  const type = await fileTypeFromBuffer(buffer);
  return type?.mime;
}
```

---

## 八、总结

### 原版 Mini OpenClaw
- ❌ **不能**实现故事场景
- 缺少文件检测、Shell执行、HTTP请求能力

### 增强版 Mini OpenClaw（添加3个模块）
- ✅ **能**实现故事场景
- 保留"自主组合工具解决问题"的核心体验
- 代码量控制在 ~200 行新增

### 关键洞察
> "足智多谋的野兽"不需要所有功能，但需要**基础工具的组合自由度**。

Mini版只要提供：
1. **读/写文件**
2. **执行命令**
3. **发起网络请求**
4. **检测文件类型**

Agent 就能像故事中的那样，自主串联链路解决问题。

---

## 参考文档

- [mini_openclaw_guide.md](./mini_openclaw_guide.md) - 原版简版指南
- [autonomous_agent_story_analysis.md](./autonomous_agent_story_analysis.md) - 故事深度分析
- [src/media/mime.ts](../src/media/mime.ts) - 完整版文件检测
- [src/agents/bash-tools.exec.ts](../src/agents/bash-tools.exec.ts) - 完整版 Shell 执行
