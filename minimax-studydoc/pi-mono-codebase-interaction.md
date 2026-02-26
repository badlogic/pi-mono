# Pi-Mono 大型代码库交互技术研究

## 概述

当代码仓库规模非常大时（如包含数万文件、数百万行代码），如何让 AI Agent 有效与代码库交互是一个关键技术挑战。Pi-Mono（基于 pi-coding-agent）采用了多种技术手段来解决这个问题。

---

## 一、核心策略：按需读取 + 智能截断

### 1.1 文件读取截断机制

Pi-Mono 的 `readTool` 不会一次性读取整个文件，而是采用智能截断策略：

```typescript
// packages/coding-agent/src/core/tools/truncate.ts
const DEFAULT_MAX_LINES = 300;        // 默认最多读取300行
const DEFAULT_MAX_BYTES = 50 * 1024;  // 或 50KB（取先到者）
```

**分页读取**：支持 `offset` 和 `limit` 参数，让 AI 可以分块读取大文件：

```
read("file.ts", { offset: 0, limit: 100 })   // 读取前100行
read("file.ts", { offset: 100, limit: 100 }) // 读取第100-200行
```

### 1.2 Grep 搜索限制

```typescript
// packages/coding-agent/src/core/tools/grep.ts
const DEFAULT_LIMIT = 100;  // 默认最多返回100个匹配
const GREP_MAX_LINE_LENGTH = 500; // 每行最多500字符
```

---

## 二、搜索工具：精准定位代码

### 2.1 Grep - 内容搜索

基于 ripgrep (rg) 实现，支持：
- 正则表达式搜索
- 文件类型过滤 (`glob: "*.ts"`)
- 忽略大小写
- 上下文行 (`context: 3`)
- 尊重 `.gitignore`

### 2.2 Find - 文件查找

基于 `fd` 工具实现：
- Glob 模式匹配：`"**/*.test.ts"`
- 限制结果数量：`limit: 1000`
- 自动忽略隐藏文件、node_modules 等

### 2.3 Ls - 目录探索

列出目录内容，帮助 AI 了解项目结构。

---

## 三、上下文管理：Compaction 压缩

### 3.1 什么是 Compaction？

当对话上下文接近模型的上下文窗口上限时，Pi-Mono 会自动压缩历史对话，保留关键信息：

```typescript
// packages/coding-agent/src/core/compaction/compaction.ts
export interface CompactionSettings {
  enabled?: boolean;           // 默认开启
  reserveTokens?: number;      // 保留 token 数（默认 16384）
  keepRecentTokens?: number;  // 保留最近 token（默认 20000）
}
```

### 3.2 压缩策略

1. **计算当前上下文 token 数**
2. **判断是否需要压缩**：当 `contextTokens > contextWindow - reserveTokens` 时触发
3. **生成摘要**：调用 LLM 将历史对话压缩成简短摘要
4. **替换原始消息**：用摘要替代原始消息，释放 token 空间

### 3.3 Branch Summary（分支摘要）

支持会话分支，保留每个分支的关键信息：

```typescript
// session-manager.ts
type BranchSummaryEntry = {
  type: "branch_summary";
  summary: string;
  tokensSaved: number;
};
```

---

## 四、项目上下文文件：AGENTS.md

### 4.1 上下文文件加载

Pi-Mono 会自动从以下位置加载上下文文件：

```
~/.pi/agent/AGENTS.md          # 全局配置
./AGENTS.md                    # 项目根目录
./src/AGENTS.md                # 子目录
./packages/*/AGENTS.md          # monorepo 包目录
```

### 4.2 用途

- 定义项目的代码规范
- 指定要忽略的文件/目录
- 提供项目特定的指令
- 说明技术栈和架构

---

## 五、工具设计原则

### 5.1 小而精的工具

每个工具只做一件事：
- `read`: 读取文件
- `grep`: 搜索内容
- `find`: 查找文件
- `bash`: 执行命令
- `edit`: 编辑文件
- `write`: 写入文件

### 5.2 可插拔的操作接口

```typescript
// grep.ts 中的操作接口示例
export interface GrepOperations {
  isDirectory: (path: string) => Promise<boolean>;
  readFile: (path: string) => Promise<string>;
}

// 可以扩展为远程操作（如 SSH）
```

---

## 六、错误处理与重试

### 6.1 自动重试机制

```typescript
// settings-manager.ts
export interface RetrySettings {
  enabled?: boolean;      // 默认开启
  maxRetries?: number;    // 默认 3 次
  baseDelayMs?: number;   // 基础延迟 2000ms（指数退避）
  maxDelayMs?: number;    // 最大延迟 60000ms
}
```

### 6.2 模型回退

当指定模型不可用时，自动回退到可用模型：

```typescript
// model-resolver.ts
const fallback = parseModelPattern(cliModel, availableModels, {...});
if (fallback.model) {
  // 使用回退模型
}
```

---

## 七、扩展性设计

### 7.1 自定义工具

通过 `customTools` 选项添加自定义工具：

```typescript
const { session } = await createAgentSession({
  customTools: [
    {
      name: "myTool",
      description: "自定义工具",
      parameters: {...},
      execute: async (toolCallId, args) => {
        // 实现逻辑
      }
    }
  ]
});
```

### 7.2 扩展系统 (Extensions)

支持更复杂的扩展功能，包括：
- 自定义 Slash 命令
- UI 组件覆盖
- 消息渲染器
- 工具执行钩子

---

## 八、适用场景分析

| 场景 | 推荐策略 |
|------|----------|
| 小型项目 (<100 文件) | 直接读取所有文件 |
| 中型项目 (100-1000 文件) | 使用 grep/find 定位 + 读取关键文件 |
| 大型项目 (1000+ 文件) | 利用 AGENTS.md 提供上下文 + 压缩历史 |
| 超大型项目 | 结合代码索引 + 分模块处理 |

---

## 九、总结

Pi-Mono 通过以下核心技术实现与大型代码库的有效交互：

1. **按需读取**：智能截断 + 分页读取，避免一次性加载大量数据
2. **精准搜索**：grep/find 工具帮助快速定位代码
3. **上下文压缩**：自动压缩历史对话，管理 token 消耗
4. **项目上下文**：通过 AGENTS.md 提供项目级指导
5. **错误恢复**：重试机制和模型回退保证稳定性
6. **可扩展架构**：支持自定义工具和扩展

这种设计遵循了"让 AI 自己探索"的原则，而不是预先将整个代码库嵌入上下文。
