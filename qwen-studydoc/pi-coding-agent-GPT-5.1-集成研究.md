# pi-coding-agent 集成 GPT-5.1 研究文档

## 1. GPT-5.1 核心特性

### 1.1 模型版本

GPT-5.1 提供两个主要版本：

| 版本 | 特点 | 适用场景 |
|------|------|----------|
| **GPT-5.1 Instant** | 更温暖、更智能、更好的指令遵循 | 低延迟、常规任务 |
| **GPT-5.1 Thinking** | 更强的推理能力、动态思考时间 | 复杂任务、需要深度思考 |

**API 模型名称**：
- `gpt-5.1-chat-latest` - Instant 版本
- `gpt-5.1` - Thinking 版本（带自适应推理）

### 1.2 核心改进

1. **自适应推理**：根据任务复杂度动态调整思考时间
2. **指令遵循**：更可靠地遵循用户指令
3. **输出控制**：更好的输出格式和长度控制
4. **并行工具调用**：更高效的工具调用执行
5. **非推理模式**：`none` 模式提供低延迟交互

### 1.3 与 GPT-5 的对比

| 特性 | GPT-5 | GPT-5.1 |
|------|-------|---------|
| 推理时间 | 固定 | 动态调整 |
| 输出长度 | 可能过长 | 更精确控制 |
| 指令遵循 | 良好 | 更可靠 |
| 并行工具调用 | 支持 | 更高效 |
| 非推理模式 | 无 | 支持 |

## 2. Prompt 设计注意事项

### 2.1 输出长度控制

GPT-5.1 可能过于简洁或过于冗长，需要明确控制：

#### 2.1.1 紧凑输出（小改动）

```
- Tiny/small single-file change (≤ ~10 lines): 2–5 sentences or ≤3 bullets. No headings. 0–1 short snippet (≤3 lines) only if essential.
```

#### 2.1.2 中等输出（中等改动）

```
- Medium change (single area or a few files): ≤6 bullets or 6–10 sentences. At most 1–2 short snippets total (≤8 lines each).
```

#### 2.1.3 大型输出（大型改动）

```
- Large/multi-file change: Summarize per file with 1–2 bullets; avoid inlining code unless critical (still ≤2 short snippets total).
```

#### 2.1.4 最佳实践

```typescript
// 在系统提示中添加输出长度控制
const systemPrompt = `
# Output Format Rules

- **Tiny changes** (≤10 lines): 2-5 sentences or ≤3 bullets. No headings.
- **Medium changes**: ≤6 bullets or 6-10 sentences. Max 2 short snippets.
- **Large changes**: 1-2 bullets per file. Max 2 short snippets total.
- **Never include**: "before/after" pairs, full method bodies, large code blocks.
- **Prefer**: File/symbol names over code fences in final answers.
`;
```

### 2.2  verbosity 参数控制

GPT-5.1 支持 `verbosity` 参数控制输出详细程度：

| 值 | 描述 | 适用场景 |
|----|------|----------|
| `0` | 最简洁 | 快速反馈、小改动 |
| `0.5` | 中等 | 一般任务 |
| `1` | 详细 | 复杂任务、需要解释 |

### 2.3 持久性（Persistence）

GPT-5.1 可能过早终止，需要强调持久性：

```typescript
const systemPrompt = `
# Persistence Requirements

- Treat yourself as an autonomous senior pair-programmer
- Once given a direction, proactively gather context, plan, implement, test, and refine
- Persist until the task is fully handled end-to-end
- Do not stop at analysis or partial fixes
- Carry changes through implementation, verification, and explanation
- Be extremely biased for action
`;
```

### 2.4 工具调用格式

#### 2.4.1 工具描述

```typescript
{
  name: "apply_patch",
  description: "Apply a patch to a file. Use when you need to make code changes. Include the file path and the patch content.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path to the file to modify" },
      patch: { type: "string", description: "The patch content in unified diff format" }
    },
    required: ["file_path", "patch"]
  }
}
```

#### 2.4.2 工具使用规则

```typescript
const systemPrompt = `
# Tool Usage Rules

- When applying code changes, you MUST use the apply_patch tool
- Do NOT guess file paths or patch content — ask for missing details
- After calling the tool, confirm the change naturally
- For multi-file changes, batch tool calls when possible
- Always verify the tool output before proceeding
`;
```

### 2.5 并行工具调用

```typescript
const systemPrompt = `
# Parallel Tool Usage

- Parallelize tool calls whenever possible
- Batch reads (read_file) to speed up context gathering
- Batch edits (apply_patch) when making multiple changes
- Use parallel execution for independent tasks
- Monitor all parallel operations and handle errors appropriately
`;
```

### 2.6 计划工具（Planning Tool）

对于中大型任务，必须使用计划工具：

```typescript
{
  name: "update_plan",
  description: "Create or update a task plan. Use for medium/large tasks before any code changes.",
  parameters: {
    type: "object",
    properties: {
      merge: { type: "boolean", description: "Merge with existing plan" },
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique task ID" },
            content: { type: "string", description: "Task description" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "Task status" }
          },
          required: ["id", "content", "status"]
        }
      }
    },
    required: ["merge", "todos"]
  }
}
```

#### 2.6.1 计划工具使用规则

```typescript
const systemPrompt = `
# Plan Tool Usage Rules

- For medium/large tasks, you MUST create a plan before any code changes
- Create 2-5 milestone/outcome items (avoid micro-steps)
- Maintain statuses: exactly one item in_progress at a time
- Mark items complete when done, or cancel/defer with reason
- End of turn invariant: zero in_progress and zero pending
- For very short tasks (≤10 lines), you may skip the plan tool
`;
```

### 2.7 用户更新（User Updates）

对于长时间运行的任务，需要定期更新用户：

```typescript
const systemPrompt = `
# User Update Requirements

- Send short updates (1-2 sentences) every few tool calls
- Post an update at least every 6 execution steps or 8 tool calls
- Before the first tool call, give a quick plan with goal, constraints, next steps
- While exploring, call out meaningful new information and discoveries
- Always state at least one concrete outcome since the prior update
- If a longer run occurred, start the next update with a 1-2 sentence synthesis
- End with a brief recap and any follow-up steps
- In the recap, include a checklist of planned items with status: Done or Closed
`;
```

### 2.8 指令遵循（Instruction Following）

GPT-5.1 擅长遵循指令，需要注意：

1. **避免冲突指令**：确保系统提示中没有相互矛盾的指令
2. **明确指令**：使用清晰、具体的语言描述期望的行为
3. **检查指令**：在系统提示中明确指出需要遵循的规则

```typescript
const systemPrompt = `
# Instruction Following

You MUST follow all instructions in this system prompt exactly.
Do not ignore any requirements or make assumptions about what the user wants.
If instructions are ambiguous, ask for clarification rather than making assumptions.
`;
```

### 2.9 非推理模式（None Reasoning Mode）

GPT-5.1 支持 `none` 推理模式，适用于低延迟场景：

```typescript
// 在 API 调用中指定推理模式
{
  model: "gpt-5.1-chat-latest",
  reasoning_effort: "none" // 或 "low", "medium", "high"
}
```

#### 2.9.1 非推理模式提示

```typescript
const systemPrompt = `
# None Reasoning Mode

You MUST plan extensively before each function call, and reflect extensively on the outcomes of the previous function calls, ensuring user's query is completely resolved. DO NOT do this entire process by making function calls only, as this can impair your ability to solve the problem and think insightfully. In addition, ensure function calls have the correct arguments.
`;
```

## 3. Server App 集成注意事项

### 3.1 模型选择

```typescript
import { getModel } from "@mariozechner/pi-coding-agent";

// 选择 GPT-5.1 Thinking 版本（推荐用于复杂任务）
const model = getModel("openai", "gpt-5.1");

// 或选择 GPT-5.1 Instant 版本（推荐用于低延迟场景）
const model = getModel("openai", "gpt-5.1-chat-latest");
```

### 3.2 推理模式配置

```typescript
// 在 SDK 配置中指定推理模式
const config = {
  model: getModel("openai", "gpt-5.1"),
  // reasoning_effort: "none" | "low" | "medium" | "high"
  // 默认为 "medium"，根据任务复杂度自适应
};
```

### 3.3 系统提示构造

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";

async function createGPT51AgentSession() {
  const { session } = await createAgentSession({
    systemPrompt: `
# Agent Persona

You are an autonomous senior pair-programmer with expertise in code analysis, refactoring, and implementation.

# Core Principles

1. **Persistence**: Complete tasks end-to-end without requiring follow-up prompts
2. **Action Bias**: Assume action is needed unless explicitly told otherwise
3. **Efficiency**: Use concise language, avoid unnecessary acknowledgments
4. **Completeness**: Verify all changes before ending the turn

# Output Format Rules

- **Tiny changes** (≤10 lines): 2-5 sentences or ≤3 bullets. No headings.
- **Medium changes**: ≤6 bullets or 6-10 sentences. Max 2 short snippets.
- **Large changes**: 1-2 bullets per file. Max 2 short snippets total.
- **Never include**: "before/after" pairs, full method bodies, large code blocks.
- **Prefer**: File/symbol names over code fences in final answers.

# Persistence Requirements

- Treat yourself as an autonomous senior pair-programmer
- Once given a direction, proactively gather context, plan, implement, test, and refine
- Persist until the task is fully handled end-to-end
- Do not stop at analysis or partial fixes
- Carry changes through implementation, verification, and explanation
- Be extremely biased for action

# Tool Usage Rules

- When applying code changes, you MUST use the apply_patch tool
- Do NOT guess file paths or patch content — ask for missing details
- After calling the tool, confirm the change naturally
- For multi-file changes, batch tool calls when possible
- Always verify the tool output before proceeding

# Parallel Tool Usage

- Parallelize tool calls whenever possible
- Batch reads (read_file) to speed up context gathering
- Batch edits (apply_patch) when making multiple changes
- Use parallel execution for independent tasks
- Monitor all parallel operations and handle errors appropriately

# Plan Tool Usage Rules

- For medium/large tasks, you MUST create a plan before any code changes
- Create 2-5 milestone/outcome items (avoid micro-steps)
- Maintain statuses: exactly one item in_progress at a time
- Mark items complete when done, or cancel/defer with reason
- End of turn invariant: zero in_progress and zero pending
- For very short tasks (≤10 lines), you may skip the plan tool

# User Update Requirements

- Send short updates (1-2 sentences) every few tool calls
- Post an update at least every 6 execution steps or 8 tool calls
- Before the first tool call, give a quick plan with goal, constraints, next steps
- While exploring, call out meaningful new information and discoveries
- Always state at least one concrete outcome since the prior update
- If a longer run occurred, start the next update with a 1-2 sentence synthesis
- End with a brief recap and any follow-up steps
- In the recap, include a checklist of planned items with status: Done or Closed

# Instruction Following

You MUST follow all instructions in this system prompt exactly.
Do not ignore any requirements or make assumptions about what the user wants.
If instructions are ambiguous, ask for clarification rather than making assumptions.
    `,
  });

  return session;
}
```

### 3.4 配置示例

```typescript
import { createAgentSession, getModel } from "@mariozechner/pi-coding-agent";

async function createGPT51Config() {
  const config = {
    // 模型配置
    model: getModel("openai", "gpt-5.1"), // Thinking 版本
    // reasoning_effort: "medium", // 自适应推理（默认）
    
    // 或使用 Instant 版本（低延迟）
    // model: getModel("openai", "gpt-5.1-chat-latest"),
    // reasoning_effort: "none", // 非推理模式
    
    // 重试配置
    retry: {
      enabled: true,
      maxRetries: 1,
      baseDelayMs: 2000,
      maxDelayMs: 30000,
    },
    
    // 工具超时
    tools: {
      write: { timeout: 30000 },
      edit: { timeout: 30000 },
      read: { timeout: 15000 },
      bash: { timeout: 60000 },
    },
  };
  
  return config;
}
```

## 4. Sub-Agent 构造注意事项

### 4.1 Sub-Agent 系统提示

每个 Sub-Agent 需要明确的系统提示：

```typescript
// scout-refactor.md
---
name: scout-refactor
description: 代码重构分析专家，识别需要重构的代码区域
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---

# Agent Persona

You are a code refactoring analysis expert. Your task is to analyze the codebase and identify areas that need refactoring.

# Core Principles

1. **Persistence**: Complete analysis end-to-end
2. **Action Bias**: Assume action is needed unless told otherwise
3. **Efficiency**: Use concise language
4. **Completeness**: Verify all findings

# Output Format Rules

- **Tiny changes** (≤10 lines): 2-5 sentences or ≤3 bullets. No headings.
- **Medium changes**: ≤6 bullets or 6-10 sentences. Max 2 short snippets.
- **Large changes**: 1-2 bullets per file. Max 2 short snippets total.

# Persistence Requirements

- Treat yourself as an autonomous senior pair-programmer
- Persist until the task is fully handled end-to-end
- Do not stop at analysis or partial fixes

# Tool Usage Rules

- When analyzing code, you MUST use the read, grep, find tools
- Do NOT guess file paths — ask for missing details
- After calling the tool, confirm the findings naturally

# Parallel Tool Usage

- Parallelize tool calls whenever possible
- Batch reads to speed up context gathering

# Plan Tool Usage Rules

- For medium/large tasks, you MUST create a plan before any analysis
- Create 2-5 milestone/outcome items

# User Update Requirements

- Send short updates every few tool calls
- Post an update at least every 8 tool calls
```

### 4.2 Sub-Agent 配置

```typescript
// 在 agents.ts 中添加 Sub-Agent 配置
{
  name: "scout-refactor",
  description: "代码重构分析专家，识别需要重构的代码区域",
  tools: ["read", "grep", "find", "ls", "bash"],
  model: getModel("openai", "gpt-5.1-chat-latest"), // 使用 Instant 版本（快速分析）
  systemPrompt: `
# Agent Persona

You are a code refactoring analysis expert. Your task is to analyze the codebase and identify areas that need refactoring.

# Core Principles

1. **Persistence**: Complete analysis end-to-end
2. **Action Bias**: Assume action is needed unless told otherwise
3. **Efficiency**: Use concise language
4. **Completeness**: Verify all findings

# Output Format Rules

- **Tiny changes** (≤10 lines): 2-5 sentences or ≤3 bullets. No headings.
- **Medium changes**: ≤6 bullets or 6-10 sentences. Max 2 short snippets.
- **Large changes**: 1-2 bullets per file. Max 2 short snippets total.

# Persistence Requirements

- Treat yourself as an autonomous senior pair-programmer
- Persist until the task is fully handled end-to-end
- Do not stop at analysis or partial fixes

# Tool Usage Rules

- When analyzing code, you MUST use the read, grep, find tools
- Do NOT guess file paths — ask for missing details
- After calling the tool, confirm the findings naturally

# Parallel Tool Usage

- Parallelize tool calls whenever possible
- Batch reads to speed up context gathering

# Plan Tool Usage Rules

- For medium/large tasks, you MUST create a plan before any analysis
- Create 2-5 milestone/outcome items

# User Update Requirements

- Send short updates every few tool calls
- Post an update at least every 8 tool calls
  `
}
```

### 4.3 Sub-Agent 链式调用

```typescript
// 在 SKILL 中使用链式调用
const chain = [
  {
    agent: "scout-refactor",
    task: "分析代码库，识别需要重构的区域"
  },
  {
    agent: "planner-refactor",
    task: "根据 Scout 的分析结果，设计重构方案 {previous}"
  },
  {
    agent: "worker-refactor",
    task: "根据 Planner 的方案，执行代码重构 {previous}"
  },
  {
    agent: "reviewer-refactor",
    task: "审查重构后的代码 {previous}"
  },
  {
    agent: "documenter-refactor",
    task: "更新文档和变更日志 {previous}"
  }
];
```

## 5. 最佳实践总结

### 5.1 Prompt 设计

| 项目 | 注意事项 |
|------|----------|
| **输出长度** | 明确指定紧凑/中等/大型输出的格式 |
| **持久性** | 强调自主完成任务，不要过早终止 |
| **工具调用** | 明确工具使用规则，鼓励并行调用 |
| **计划工具** | 中大型任务必须使用计划工具 |
| **用户更新** | 定期更新用户，特别是在长时间运行时 |
| **指令遵循** | 避免冲突指令，使用清晰具体的语言 |

### 5.2 Server App 集成

| 项目 | 注意事项 |
|------|----------|
| **模型选择** | Thinking 版本用于复杂任务，Instant 版本用于低延迟场景 |
| **推理模式** | 默认自适应，或指定 none/low/medium/high |
| **系统提示** | 包含所有必要的规则和格式要求 |
| **重试配置** | 设置合理的重试次数和延迟 |
| **工具超时** | 设置合理的工具超时时间 |

### 5.3 Sub-Agent 构造

| 项目 | 注意事项 |
|------|----------|
| **系统提示** | 明确 Agent 的角色、职责和输出格式 |
| **模型选择** | 使用快速模型（如 Haiku）进行分析，使用强大模型进行复杂任务 |
| **工具配置** | 限制 Agent 可用的工具，遵循最小权限原则 |
| **链式调用** | 使用 `{previous}` 占位符传递上下文 |
| **错误处理** | 每个 Agent 都有错误处理机制 |

### 5.4 性能优化

| 项目 | 注意事项 |
|------|----------|
| **并行工具调用** | 鼓励并行执行独立任务 |
| **计划工具** | 使用计划工具跟踪进度 |
| **用户更新** | 定期更新用户，避免长时间无响应 |
| **推理模式** | 对于简单任务使用 none 模式 |
| **输出长度** | 控制输出长度，避免不必要的 token 消耗 |

## 6. 参考资料

- [GPT-5.1 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-1_prompting_guide/)
- [GPT-5.1 Release Notes](https://openai.com/index/gpt-5-1/)
- [pi-coding-agent 文档](https://github.com/badlogic/pi-mono)
- [Sub-Agent 扩展](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent)
- [Agent Skills](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/skills)