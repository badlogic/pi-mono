# pi-coding-agent Tools 深度分析与 Custom Tool 开发指南

## 目录

1. [内置 Tools 架构分析](#1-内置-tools-架构分析)
2. [Tool 工厂函数详解](#2-tool-工厂函数详解)
3. [Custom Tool 开发指南](#3-custom-tool-开发指南)
4. [常见问题与最佳实践](#4-常见问题与最佳实践)

---

## 1. 内置 Tools 架构分析

### 1.1 Tool 的基本结构

所有 tools 都遵循统一的接口定义，基于 [`AgentTool`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\extensions\types.ts#L337-L363) 类型：

```typescript
interface AgentTool<TSchema extends TSchema = TSchema, TDetails = unknown> {
  name: string;                    // 工具名称（LLM 调用时使用）
  label: string;                   // UI 显示标签
  description: string;             // LLM 理解的工具描述
  parameters: TSchema;             // TypeBox 参数 schema
  execute: (                       // 执行函数
    toolCallId: string,
    params: Static<TSchema>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>
  ) => Promise<AgentToolResult<TDetails>>;
}
```

### 1.2 内置 Tools 列表

从 [`index.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\index.ts#L89-L139) 导出的工具：

| 工具名称 | 工厂函数 | 用途 | 是否可写 |
|---------|---------|------|---------|
| `read` | [`createReadTool`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\read.ts#L48-L222) | 读取文件内容 | ❌ 只读 |
| `bash` | [`createBashTool`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\bash.ts#L166-L321) | 执行 shell 命令 | ✅ 可执行 |
| `edit` | [`createEditTool`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\edit.ts#L58-L227) | 编辑文件内容 | ✅ 可写 |
| `write` | [`createWriteTool`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\write.ts#L38-L118) | 写入新文件 | ✅ 可写 |
| `grep` | [`createGrepTool`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\grep.ts#L63-L346) | 搜索文件内容 | ❌ 只读 |
| `find` | [`createFindTool`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\find.ts) | 查找文件 | ❌ 只读 |
| `ls` | [`createLsTool`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\ls.ts#L42-L170) | 列出目录内容 | ❌ 只读 |

### 1.3 预设工具组合

```typescript
// 完整编码工具（默认）
export const codingTools: Tool[] = [readTool, bashTool, editTool, writeTool];

// 只读工具（安全模式）
export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool];

// 所有工具
export const allTools = {
  read: readTool,
  bash: bashTool,
  edit: editTool,
  write: writeTool,
  grep: grepTool,
  find: findTool,
  ls: lsTool,
};
```

---

## 2. Tool 工厂函数详解

### 2.1 工厂函数签名

所有工具都提供工厂函数，允许指定自定义 `cwd`：

```typescript
// 通用签名
function createXxxTool(cwd: string, options?: XxxToolOptions): AgentTool<typeof xxxSchema>;
```

**为什么需要工厂函数？**
- 允许在不同的工作目录使用工具
- 支持远程文件系统（通过 `operations` 选项）
- 便于测试和模拟

### 2.2 各工具详细分析

#### 2.2.1 createReadTool

**源码位置**：[`read.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\read.ts#L48-L222)

**Schema**：
```typescript
const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
```

**特点**：
- ✅ 支持文本文件和图片（jpg, png, gif, webp）
- ✅ 自动截断（默认 2000 行或 1024KB）
- ✅ 支持分页读取（offset/limit）
- ✅ 图片自动调整大小（默认 2000x2000 max）

**Options**：
```typescript
interface ReadToolOptions {
  autoResizeImages?: boolean;  // 默认 true
  operations?: ReadOperations; // 自定义文件读取操作
}
```

**使用示例**：
```typescript
import { createReadTool } from "@mariozechner/pi-coding-agent";

// 基本使用
const readTool = createReadTool("/app/workspace");

// 自定义选项
const readTool = createReadTool("/app/workspace", {
  autoResizeImages: false,
  operations: {
    readFile: async (path) => {
      // 自定义读取逻辑（如从 S3 读取）
      return fsReadFile(path);
    },
    access: async (path) => {
      // 自定义权限检查
      await fsAccess(path, constants.R_OK);
    },
  },
});
```

#### 2.2.2 createBashTool

**源码位置**：[`bash.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\bash.ts#L166-L321)

**Schema**：
```typescript
const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
});
```

**特点**：
- ✅ 流式输出（实时返回 stdout/stderr）
- ✅ 自动截断（默认 2000 行或 1024KB）
- ✅ 输出保存到临时文件（如果截断）
- ✅ 支持超时控制
- ✅ 支持进程树终止

**Options**：
```typescript
interface BashToolOptions {
  commandPrefix?: string;      // 命令前缀（如设置 alias）
  spawnHook?: BashSpawnHook;   // 自定义 spawn 钩子
  operations?: BashOperations; // 自定义执行操作
}
```

**使用示例**：
```typescript
import { createBashTool } from "@mariozechner/pi-coding-agent";

// 基本使用
const bashTool = createBashTool("/app/workspace");

// 启用 alias 支持
const bashTool = createBashTool("/app/workspace", {
  commandPrefix: "shopt -s expand_aliases",
});

// 自定义执行（如 SSH 远程执行）
const bashTool = createBashTool("/app/workspace", {
  operations: {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      // 通过 SSH 执行
      return sshExec(command, { onData, signal, timeout });
    },
  },
});
```

#### 2.2.3 createEditTool

**源码位置**：[`edit.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\edit.ts#L58-L227)

**Schema**：
```typescript
const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit" }),
  oldText: Type.String({ description: "Exact text to find and replace" }),
  newText: Type.String({ description: "New text to replace with" }),
});
```

**特点**：
- ✅ 精确匹配替换（包括空白字符）
- ✅ 自动生成 diff
- ✅ 保留行尾符（CRLF/LF）
- ✅ 保留 BOM 标记
- ✅ 模糊查找支持

**使用示例**：
```typescript
import { createEditTool } from "@mariozechner/pi-coding-agent";

const editTool = createEditTool("/app/workspace");

// 自定义操作（如远程编辑）
const editTool = createEditTool("/app/workspace", {
  operations: {
    readFile: async (path) => sshReadFile(path),
    writeFile: async (path, content) => sshWriteFile(path, content),
    access: async (path) => sshAccess(path, constants.R_OK | constants.W_OK),
  },
});
```

#### 2.2.4 createWriteTool

**源码位置**：[`write.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\write.ts#L38-L118)

**Schema**：
```typescript
const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write" }),
  content: Type.String({ description: "Content to write" }),
});
```

**特点**：
- ✅ 自动创建父目录
- ✅ 覆盖已存在文件
- ✅ 支持 AbortSignal

**使用示例**：
```typescript
import { createWriteTool } from "@mariozechner/pi-coding-agent";

const writeTool = createWriteTool("/app/workspace");

// 自定义写入（如写入 S3）
const writeTool = createWriteTool("/app/workspace", {
  operations: {
    writeFile: async (path, content) => s3Upload(path, content),
    mkdir: async (dir) => s3CreateDirectory(dir),
  },
});
```

#### 2.2.5 其他工具（grep, find, ls）

这些工具都是只读工具，用于文件搜索和浏览：

```typescript
import {
  createGrepTool,
  createFindTool,
  createLsTool,
} from "@mariozechner/pi-coding-agent";

const grepTool = createGrepTool("/app/workspace");
const findTool = createFindTool("/app/workspace");
const lsTool = createLsTool("/app/workspace");
```

---

## 3. Custom Tool 开发指南

### 3.1 什么是 Custom Tool？

Custom Tool 是通过扩展系统注册的自定义工具，允许 LLM 调用你的自定义逻辑。

**关键区别**：
- **内置 Tools**：通过 `createXxxTool()` 创建，直接传递给 `createAgentSession()`
- **Custom Tools**：通过扩展的 `pi.registerTool()` 注册，由扩展系统管理

### 3.2 Custom Tool 的完整结构

根据 [`types.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\extensions\types.ts#L337-L363)：

```typescript
interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
  // 基本信息
  name: string;              // 工具名称（LLM 调用标识符）
  label: string;             // UI 显示名称
  description: string;       // LLM 理解的描述
  parameters: TParams;       // TypeBox schema 定义参数
  
  // 执行函数
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
  
  // 可选：自定义渲染
  renderCall?: (args: Static<TParams>, theme: Theme) => Component;
  renderResult?: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme) => Component;
}
```

### 3.3 开发步骤

#### 步骤 1：创建扩展文件

```typescript
// my-extension.ts
import type { ExtensionFactory, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export const myExtension: ExtensionFactory = async (pi: ExtensionAPI, ctx: ExtensionContext) => {
  // 扩展初始化代码
  console.log("Extension loaded");
};
```

#### 步骤 2：定义 Tool Schema

使用 TypeBox 定义参数 schema：

```typescript
import { Type } from "@sinclair/typebox";
import { type Static } from "@sinclair/typebox";

// 定义参数 schema
const myToolSchema = Type.Object({
  url: Type.String({ description: "URL to fetch" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in ms", default: 5000 })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
});

type MyToolInput = Static<typeof myToolSchema>;
```

#### 步骤 3：实现 execute 函数

```typescript
import type { AgentToolResult } from "@mariozechner/pi-coding-agent";

async function executeMyTool(
  toolCallId: string,
  params: MyToolInput,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult> {
  // 1. 检查是否已取消
  if (signal?.aborted) {
    return {
      content: [{ type: "text", text: "Operation cancelled" }],
      isError: true,
    };
  }

  // 2. 执行实际逻辑
  try {
    const response = await fetch(params.url, {
      signal: signal as any,
      headers: params.headers,
      timeout: params.timeout,
    });

    const data = await response.text();

    // 3. 返回结果
    return {
      content: [{ type: "text", text: `Fetched ${data.length} bytes from ${params.url}` }],
      details: undefined,
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}
```

#### 步骤 4：注册 Tool

```typescript
export const myExtension: ExtensionFactory = async (pi: ExtensionAPI, ctx: ExtensionContext) => {
  // 注册工具
  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    description: "Fetch content from a URL. Use this to retrieve web pages or API responses.",
    parameters: myToolSchema,
    execute: executeMyTool,
    
    // 可选：自定义渲染
    renderResult: (result, options, theme) => {
      return tui.text(result.content[0].text);
    },
  });
};
```

#### 步骤 5：在 createAgentSession 中注册扩展

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { myExtension } from "./my-extension";

const result = await createAgentSession({
  cwd: "/app/workspace",
  customExtensions: [myExtension], // 注册你的扩展
});
```

### 3.4 完整示例：HTTP Fetch Tool

```typescript
// fetch-extension.ts
import type {
  ExtensionFactory,
  ExtensionAPI,
  ExtensionContext,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";

// 1. 定义 Schema
const fetchSchema = Type.Object({
  url: Type.String({ description: "The URL to fetch" }),
  method: Type.Optional(
    Type.Enum(
      { GET: "GET", POST: "POST", PUT: "PUT", DELETE: "DELETE" },
      { description: "HTTP method", default: "GET" }
    )
  ),
  body: Type.Optional(Type.String({ description: "Request body (for POST/PUT)" })),
  timeout: Type.Optional(Type.Number({ description: "Timeout in ms", default: 10000 })),
});

type FetchInput = Static<typeof fetchSchema>;

// 2. 实现 execute
async function executeFetch(
  toolCallId: string,
  params: FetchInput,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult> {
  if (signal?.aborted) {
    return {
      content: [{ type: "text", text: "Request cancelled" }],
      isError: true,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), params.timeout || 10000);
    
    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    const response = await fetch(params.url, {
      method: params.method || "GET",
      body: params.body,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
    });

    clearTimeout(timeoutId);

    const text = await response.text();

    return {
      content: [
        {
          type: "text",
          text: `Status: ${response.status}\n\n${text.substring(0, 2000)}${text.length > 2000 ? "..." : ""}`,
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Fetch failed: ${error.message}` }],
      isError: true,
    };
  }
}

// 3. 创建扩展
export const fetchExtension: ExtensionFactory = async (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "fetch",
    label: "Fetch URL",
    description: "Fetch content from a URL. Supports GET, POST, PUT, DELETE methods.",
    parameters: fetchSchema,
    execute: executeFetch,
  });

  console.log("Fetch tool registered");
};
```

### 3.5 Custom Tool 可以指定特定 Model 吗？

**答案：不可以直接指定，但可以通过扩展逻辑间接实现。**

#### 为什么不能直接指定？

Tool 本身是**独立于 Model** 的，它们是 LLM 可以调用的函数。Tool 的执行不依赖于特定 Model。

#### 如何实现"针对特定 Model"的效果？

**方案 1：在扩展中检查当前 Model**

```typescript
export const myExtension: ExtensionFactory = async (pi: ExtensionAPI, ctx: ExtensionContext) => {
  pi.registerTool({
    name: "smart_tool",
    label: "Smart Tool",
    description: "A tool that behaves differently based on the model",
    parameters: mySchema,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      // 获取当前使用的 Model
      const currentModel = ctx.session.model;
      
      if (currentModel?.provider === "anthropic" && currentModel?.id.includes("claude-3")) {
        // 针对 Claude 的特殊处理
        return handleForClaude(params);
      } else if (currentModel?.provider === "openai") {
        // 针对 GPT 的特殊处理
        return handleForGPT(params);
      } else {
        // 默认处理
        return handleDefault(params);
      }
    },
  });
};
```

**方案 2：通过 Tool 参数指定**

```typescript
const smartSchema = Type.Object({
  action: Type.String({ description: "Action to perform" }),
  targetModel: Type.Optional(
    Type.Enum(
      { claude: "claude", gpt: "gpt", any: "any" },
      { description: "Target model for this action" }
    )
  ),
});

execute: async (toolCallId, params, signal, onUpdate, ctx) => {
  if (params.targetModel) {
    // 根据参数决定行为
    if (params.targetModel === "claude") {
      return executeForClaude(params);
    }
  }
  // 默认行为
  return executeDefault(params);
}
```

**方案 3：注册多个 Tool 对应不同 Model**

```typescript
pi.registerTool({
  name: "analyze_claude",
  label: "Analyze (Claude)",
  description: "Analyze using Claude-optimized approach",
  parameters: analyzeSchema,
  execute: executeForClaude,
});

pi.registerTool({
  name: "analyze_gpt",
  label: "Analyze (GPT)",
  description: "Analyze using GPT-optimized approach",
  parameters: analyzeSchema,
  execute: executeForGPT,
});

// 然后在扩展中根据当前 model 动态启用/禁用工具
pi.on("session_start", () => {
  const currentModel = ctx.session.model;
  if (currentModel?.provider === "anthropic") {
    pi.setActiveTools(["analyze_claude", /* other tools */]);
  } else if (currentModel?.provider === "openai") {
    pi.setActiveTools(["analyze_gpt", /* other tools */]);
  }
});
```

### 3.6 Custom Tool 的高级特性

#### 3.6.1 流式更新（onUpdate）

```typescript
execute: async (toolCallId, params, signal, onUpdate) => {
  // 发送进度更新
  onUpdate?.({
    type: "update",
    content: [{ type: "text", text: "Starting operation..." }],
  });

  // 执行步骤 1
  await step1();
  onUpdate?.({
    type: "update",
    content: [{ type: "text", text: "Step 1 completed" }],
  });

  // 执行步骤 2
  await step2();
  onUpdate?.({
    type: "update",
    content: [{ type: "text", text: "Step 2 completed" }],
  });

  // 返回最终结果
  return {
    content: [{ type: "text", text: "All steps completed" }],
  };
}
```

#### 3.6.2 自定义渲染

```typescript
import { tui, type Component } from "@mariozechner/pi-tui";

pi.registerTool({
  name: "weather",
  label: "Weather",
  description: "Get weather information",
  parameters: weatherSchema,
  execute: executeWeather,
  
  // 自定义调用显示
  renderCall: (args, theme) => {
    return tui.vstack([
      tui.text(`🌤️  Getting weather for: ${args.city}`),
      tui.text(`Date: ${args.date || "today"}`),
    ]);
  },
  
  // 自定义结果显示
  renderResult: (result, options, theme) => {
    const data = JSON.parse(result.content[0].text);
    return tui.vstack([
      tui.text(`🌡️  Temperature: ${data.temp}°C`),
      tui.text(`💧 Humidity: ${data.humidity}%`),
      tui.text(`🌬️  Wind: ${data.wind} km/h`),
    ]);
  },
});
```

#### 3.6.3 事件监听

```typescript
export const myExtension: ExtensionFactory = async (pi: ExtensionAPI) => {
  // 监听工具调用
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "my_tool") {
      console.log("My tool is being called:", event.input);
      // 可以拦截或修改
    }
  });

  // 监听工具结果
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "my_tool") {
      console.log("My tool result:", event.result);
      // 可以修改结果
    }
  });

  // 监听 Agent 事件
  pi.on("agent_start", async (event, ctx) => {
    console.log("Agent is starting with tools:", ctx.getActiveTools());
  });
};
```

---

## 4. 常见问题与最佳实践

### 4.1 注意事项

#### ✅ 必须做的

1. **定义清晰的 Schema**
   ```typescript
   // 好的 schema
   const schema = Type.Object({
     path: Type.String({ description: "File path to read" }),
     limit: Type.Optional(Type.Number({ description: "Max lines to read", default: 100 })),
   });
   
   // 避免模糊描述
   const badSchema = Type.Object({
     path: Type.String(), // ❌ 没有描述
   });
   ```

2. **处理 AbortSignal**
   ```typescript
   execute: async (toolCallId, params, signal) => {
     if (signal?.aborted) {
       return { content: [{ type: "text", text: "Cancelled" }], isError: true };
     }
     
     signal?.addEventListener("abort", () => {
       // 清理资源
     });
   }
   ```

3. **错误处理**
   ```typescript
   try {
     // 执行逻辑
   } catch (error: any) {
     return {
       content: [{ type: "text", text: `Error: ${error.message}` }],
       isError: true,
     };
   }
   ```

4. **使用 TypeBox 验证**
   ```typescript
   // TypeBox 会自动验证参数
   const schema = Type.Object({
     count: Type.Number({ minimum: 1, maximum: 100 }),
     email: Type.String({ format: "email" }),
   });
   ```

#### ❌ 避免做的

1. **不要阻塞事件循环**
   ```typescript
   // ❌ 错误示例
   execute: async () => {
     sleepSync(10000); // 阻塞
   }
   
   // ✅ 正确示例
   execute: async () => {
     await sleep(10000); // 非阻塞
   }
   ```

2. **不要忘记清理资源**
   ```typescript
   execute: async (toolCallId, params, signal) => {
     const resource = acquireResource();
     
     try {
       return await useResource(resource);
     } finally {
       releaseResource(resource); // 总是清理
     }
   }
   ```

3. **不要返回过大的结果**
   ```typescript
   // ❌ 返回整个文件
   return { content: [{ type: "text", text: entireFileContent }] };
   
   // ✅ 截断结果
   const truncated = content.substring(0, 10000) + "...";
   return { content: [{ type: "text", text: truncated }] };
   ```

### 4.2 最佳实践

#### 4.2.1 Tool 设计原则

1. **单一职责**：每个 tool 只做一件事
   ```typescript
   // ✅ 好的设计
   registerTool({ name: "read_file", ... });
   registerTool({ name: "write_file", ... });
   
   // ❌ 糟糕的设计
   registerTool({ name: "file_operations", ... }); // 什么都做
   ```

2. **幂等性**：尽可能让 tool 可重复执行
   ```typescript
   // ✅ 幂等的 write
   execute: async ({ path, content }) => {
     await writeFile(path, content); // 总是覆盖
   }
   
   // ❌ 非幂等的 write
   execute: async ({ path, content }) => {
     if (exists(path)) throw new Error("File exists"); // 第二次执行失败
   }
   ```

3. **明确的错误信息**
   ```typescript
   // ✅ 清晰的错误
   return {
     content: [{ type: "text", text: `File not found: ${path}. Checked in ${cwd}` }],
     isError: true,
   };
   
   // ❌ 模糊的错误
   return {
     content: [{ type: "text", text: "Error" }],
     isError: true,
   };
   ```

#### 4.2.2 性能优化

1. **使用缓存**
   ```typescript
   const cache = new Map<string, string>();
   
   execute: async ({ path }) => {
     if (cache.has(path)) {
       return { content: [{ type: "text", text: cache.get(path)! }] };
     }
     
     const content = await readFile(path);
     cache.set(path, content);
     return { content: [{ type: "text", text: content }] };
   }
   ```

2. **延迟加载**
   ```typescript
   execute: async ({ largeData }) => {
     // 只在需要时处理
     const processed = await processLazy(largeData);
     return { content: [{ type: "text", text: processed }] };
   }
   ```

#### 4.2.3 测试 Custom Tool

```typescript
import { describe, it, expect } from "vitest";
import { executeMyTool } from "./my-tool";

describe("My Tool", () => {
  it("should handle valid input", async () => {
    const result = await executeMyTool(
      "call_123",
      { url: "https://example.com" },
      undefined,
      undefined,
      mockContext
    );
    
    expect(result.content[0].text).toContain("Fetched");
  });
  
  it("should handle abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    
    const result = await executeMyTool(
      "call_123",
      { url: "https://example.com" },
      controller.signal,
      undefined,
      mockContext
    );
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("cancelled");
  });
});
```

### 4.3 调试技巧

1. **启用调试日志**
   ```typescript
   execute: async (toolCallId, params, signal, onUpdate, ctx) => {
     console.log(`[MyTool] Call ${toolCallId}:`, params);
     
     try {
       // ...
     } catch (error) {
       console.error(`[MyTool] Error:`, error);
       throw error;
     }
   }
   ```

2. **使用 onUpdate 跟踪进度**
   ```typescript
   onUpdate?.({
     type: "update",
     content: [{ type: "text", text: `Step ${current}/${total}` }],
   });
   ```

3. **检查 Extension 加载**
   ```typescript
   export const myExtension: ExtensionFactory = async (pi) => {
     console.log("Extension loading...");
     
     pi.registerTool(myTool);
     
     console.log("Extension loaded, tools:", pi.getAllTools());
   };
   ```

---

## 总结

### 关键要点

1. **内置 Tools** 通过工厂函数创建，支持自定义 `cwd` 和 `operations`
2. **Custom Tools** 通过扩展系统注册，使用 `pi.registerTool()`
3. **Tool Schema** 使用 TypeBox 定义，提供类型安全和自动验证
4. **Model 特定逻辑** 不能直接指定，但可以通过检查 `ctx.session.model` 间接实现
5. **错误处理** 和 **AbortSignal** 处理是必须的
6. **流式更新** 通过 `onUpdate` 回调实现

### 资源链接

- [Tool 定义类型](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\extensions\types.ts#L337-L363)
- [扩展 API](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\extensions\types.ts#L952-L1100)
- [内置 Tools 实现](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\tools\index.ts)
- [Extension Runner](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\extensions\runner.ts)
