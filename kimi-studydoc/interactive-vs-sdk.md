# 交互模式 vs SDK 方式调用 Coding Agent 的差异分析

## 概述

pi-mono 的 coding agent 提供了两种主要的使用方式：
1. **交互模式 (Interactive Mode)**：基于 TUI（终端用户界面）的交互式体验
2. **SDK 方式**：程序化调用，用于集成到其他应用中

本文档基于对源码的分析，详细对比这两种方式的差异。

---

## 架构层次对比

### 交互模式架构

```
┌─────────────────────────────────────────────────────────────┐
│                    InteractiveMode                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   TUI 组件   │  │  键盘处理器  │  │   事件渲染组件       │  │
│  │  - Header   │  │  - Keybinding│  │  - MessageComponent │  │
│  │  - Editor   │  │  - Commands  │  │  - ToolExecution    │  │
│  │  - Footer   │  │  - SlashCmd  │  │  - BashExecution    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    AgentSession                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    Agent    │  │ SessionMgr  │  │   ExtensionRunner   │  │
│  │  (核心代理)  │  │  (会话管理)  │  │    (扩展系统)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### SDK 方式架构

```
┌─────────────────────────────────────────────────────────────┐
│                  你的应用程序代码                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  业务逻辑    │  │  事件处理器  │  │    自定义 UI         │  │
│  │  - API服务  │  │  - 消息流    │  │  - Web/Desktop      │  │
│  │  - 工作流   │  │  - 工具结果  │  │  - 日志记录          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    AgentSession                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    Agent    │  │ SessionMgr  │  │   ExtensionRunner   │  │
│  │  (核心代理)  │  │  (会话管理)  │  │    (扩展系统)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心差异对比表

| 特性 | 交互模式 (Interactive Mode) | SDK 方式 |
|------|---------------------------|----------|
| **用户界面** | 内置 TUI（终端界面） | 无内置 UI，需自行实现 |
| **输入方式** | 键盘输入、粘贴图片、拖拽文件 | 程序化调用 `session.prompt()` |
| **输出展示** | 实时渲染消息、工具执行、代码差异 | 通过事件订阅获取数据 |
| **会话存储** | 自动持久化到文件 | 可选内存或文件存储 |
| **扩展支持** | 完整支持（UI扩展、命令等） | 完整支持 |
| **快捷键** | 丰富的键盘快捷键 | 无 |
| **自动补全** | 文件路径、命令、模型选择 | 无 |
| **使用场景** | 终端交互、人工操作 | 自动化、集成、服务端 |

---

## 详细差异分析

### 1. 初始化流程差异

#### 交互模式初始化

```typescript
// InteractiveMode.init() 流程
async init(): Promise<void> {
    // 1. 加载 changelog
    this.changelogMarkdown = this.getChangelogForDisplay();
    
    // 2. 确保工具可用（fd, rg）
    const [fdPath] = await Promise.all([ensureTool("fd"), ensureTool("rg")]);
    this.fdPath = fdPath;
    
    // 3. 设置 UI 组件
    this.ui.addChild(this.headerContainer);
    this.ui.addChild(this.chatContainer);
    this.ui.addChild(this.pendingMessagesContainer);
    this.ui.addChild(this.statusContainer);
    this.ui.addChild(this.editorContainer);
    this.ui.addChild(this.footer);
    
    // 4. 设置键盘处理器
    this.setupKeyHandlers();
    this.setupEditorSubmitHandler();
    
    // 5. 初始化扩展
    await this.initExtensions();
    
    // 6. 启动 UI
    this.ui.start();
    
    // 7. 订阅 Agent 事件
    this.subscribeToAgent();
}
```

**特点：**
- 自动设置 TUI 组件（Header、Editor、Footer 等）
- 加载主题、快捷键绑定
- 设置文件自动补全（基于 fd）
- 初始化扩展系统（支持 UI 扩展）

#### SDK 方式初始化

```typescript
// SDK 方式流程
const { session, extensionsResult } = await createAgentSession({
    model: myModel,
    thinkingLevel: 'medium',
    tools: codingTools,
    sessionManager: SessionManager.inMemory(), // 或文件存储
    authStorage,
    modelRegistry,
});

// 手动订阅事件
session.subscribe((event) => {
    // 处理事件
});
```

**特点：**
- 完全控制配置选项
- 选择会话存储方式（内存/文件）
- 手动设置事件处理
- 无 UI 组件初始化

---

### 2. 输入处理差异

#### 交互模式输入

交互模式通过 `CustomEditor` 组件处理输入，支持：

```typescript
// 支持的输入类型
1. 普通文本输入
2. /command 斜杠命令（自动补全）
3. !bash 命令执行
4. @file 文件引用（自动补全）
5. 图片粘贴
6. 文件拖拽

// 键盘快捷键
- Ctrl+C: 中断
- Ctrl+L: 清屏
- Ctrl+O: 外部编辑器
- Ctrl+P: 切换模型
- Tab: 自动补全
```

**处理流程：**
```
用户输入 → Editor组件 → 解析命令 → 
如果是斜杠命令 → 执行对应逻辑
如果是普通文本 → session.prompt() → Agent处理
```

#### SDK 方式输入

SDK 方式直接调用 API：

```typescript
// 基本提示
await session.prompt("分析这个目录的代码结构");

// 带图片
await session.prompt("解释这个代码", {
    images: [{ type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } }]
});

// 流式时的队列控制
await session.prompt("新指令", { streamingBehavior: "steer" });    // 中断当前
await session.prompt("后续任务", { streamingBehavior: "followUp" }); // 排队等待

// 显式队列控制
await session.steer("立即执行");      // 中断
await session.followUp("稍后执行");   // 排队
```

---

### 3. 输出处理差异

#### 交互模式输出

交互模式有完整的渲染系统：

```typescript
// 组件渲染系统
- AssistantMessageComponent: 渲染助手消息
- ToolExecutionComponent: 渲染工具执行
- BashExecutionComponent: 渲染 Bash 执行
- UserMessageComponent: 渲染用户消息
- DiffComponent: 渲染代码差异

// 特殊功能
- 实时流式渲染
- 工具输出展开/折叠
- Thinking 块显示控制
- 图片预览
- 代码语法高亮
```

**事件处理示例：**
```typescript
// InteractiveMode 中的事件处理
private _handleAgentEvent = async (event: AgentSessionEvent): Promise<void> => {
    switch (event.type) {
        case "message_update":
            // 更新流式消息组件
            if (this.streamingComponent) {
                this.streamingComponent.update(event.message);
            }
            break;
        case "tool_execution_start":
            // 创建工具执行组件
            const toolComponent = new ToolExecutionComponent(...);
            this.pendingTools.set(event.toolCallId, toolComponent);
            break;
        case "tool_execution_end":
            // 完成工具执行显示
            const tool = this.pendingTools.get(event.toolCallId);
            if (tool) tool.setCompleted(event.result);
            break;
    }
};
```

#### SDK 方式输出

SDK 方式通过事件订阅获取原始数据：

```typescript
session.subscribe((event) => {
    switch (event.type) {
        case "message_update":
            if (event.assistantMessageEvent.type === "text_delta") {
                // 文本增量
                process.stdout.write(event.assistantMessageEvent.delta);
            }
            if (event.assistantMessageEvent.type === "thinking_delta") {
                // Thinking 输出
            }
            break;
        
        case "tool_execution_start":
            console.log(`开始执行工具: ${event.toolName}`);
            break;
        
        case "tool_execution_update":
            // 工具执行中间输出
            break;
        
        case "tool_execution_end":
            console.log(`工具执行${event.isError ? '失败' : '成功'}`);
            break;
        
        case "message_end":
            // 消息完成
            break;
    }
});
```

**特点：**
- 完全控制输出格式
- 可集成到任何 UI 框架
- 适合日志记录、数据存储

---

### 4. 会话管理差异

#### 交互模式会话管理

```typescript
// 自动管理
- 启动时自动恢复上次会话
- 自动保存消息历史
- 支持会话树导航（/session 命令）
- 支持分支（fork）
- 自动压缩（compaction）

// 用户操作
- /session: 查看会话列表
- /new: 新建会话
- /switch: 切换会话
- Ctrl+U: 分支导航
```

#### SDK 方式会话管理

```typescript
// 内存会话（无持久化）
const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
});

// 文件持久化
const { session } = await createAgentSession({
    sessionManager: SessionManager.create(process.cwd()),
});

// 继续最近会话
const { session, modelFallbackMessage } = await createAgentSession({
    sessionManager: SessionManager.continueRecent(process.cwd()),
});

// 手动操作
await session.newSession();
await session.switchSession("/path/to/session.jsonl");
await session.fork(entryId);
```

---

### 5. 扩展系统差异

两者都支持扩展系统，但交互模式有额外的 UI 扩展能力：

#### 交互模式扩展

```typescript
// UI 扩展能力
pi.ui = {
    showSelector: (items) => { /* 显示选择器 */ },
    showInput: (options) => { /* 显示输入框 */ },
    showEditor: (options) => { /* 显示编辑器 */ },
    setHeader: (component) => { /* 设置头部 */ },
    setFooter: (component) => { /* 设置底部 */ },
    addWidgetAbove: (component) => { /* 添加上方组件 */ },
    addWidgetBelow: (component) => { /* 添加下方组件 */ },
};

// 命令注册
pi.registerCommand("mycommand", {
    execute: async () => { /* 执行逻辑 */ }
});
```

#### SDK 方式扩展

```typescript
// 事件监听扩展
const loader = new DefaultResourceLoader({
    extensionFactories: [
        (pi) => {
            pi.on("agent_start", () => {
                console.log("Agent 启动");
            });
            pi.on("tool_execution_end", (event) => {
                // 记录工具执行
            });
        },
    ],
});
```

---

## 使用场景建议

### 选择交互模式当：

1. **终端用户直接使用**
   - 开发者日常编码助手
   - 代码审查和修改
   - 探索性编程

2. **需要丰富的交互体验**
   - 实时查看工具执行
   - 代码差异可视化
   - 文件自动补全

3. **人工在环 (Human-in-the-loop)**
   - 需要人工确认的操作
   - 交互式调试

### 选择 SDK 方式当：

1. **构建自定义应用**
   - Web 界面
   - 桌面应用
   - IDE 插件

2. **自动化工作流**
   - CI/CD 集成
   - 代码分析流水线
   - 自动化文档生成

3. **服务端集成**
   - API 服务
   - 后台处理任务
   - 多用户系统

4. **测试和调试**
   - 程序化测试 agent 行为
   - 批量处理
   - 性能分析

---

## 代码示例对比

### 场景：分析代码目录

#### 交互模式

```bash
# 用户直接在终端操作
pi
> 请分析当前目录的代码结构
```

#### SDK 方式

```typescript
import { createAgentSession, SessionManager, codingTools } from "@mariozechner/pi-coding-agent";

async function analyzeCodebase(repoPath: string) {
    const { session } = await createAgentSession({
        cwd: repoPath,
        tools: codingTools,
        sessionManager: SessionManager.inMemory(),
    });
    
    let analysis = "";
    
    session.subscribe((event) => {
        if (event.type === "message_update" && 
            event.assistantMessageEvent.type === "text_delta") {
            analysis += event.assistantMessageEvent.delta;
        }
    });
    
    await session.prompt("分析这个代码库的结构和主要组件");
    await session.agent.waitForIdle();
    
    return analysis;
}

// 在 Express 服务中使用
app.post("/analyze", async (req, res) => {
    const result = await analyzeCodebase(req.body.repoPath);
    res.json({ analysis: result });
});
```

---

## 总结

| 维度 | 交互模式 | SDK 方式 |
|------|---------|----------|
| **核心定位** | 终端用户界面 | 程序化 API |
| **复杂度** | 高（内置完整 UI） | 低（核心功能） |
| **灵活性** | 固定体验 | 完全可控 |
| **集成难度** | 无需集成 | 需要开发 |
| **适用人群** | 终端用户 | 开发者 |
| **扩展能力** | UI + 逻辑 | 逻辑为主 |

两种模式共享相同的底层核心（AgentSession、Agent、ExtensionRunner），差异主要体现在 I/O 层。交互模式是 SDK 之上的一层完整 UI 封装，而 SDK 提供了构建自定义应用的基础能力。
