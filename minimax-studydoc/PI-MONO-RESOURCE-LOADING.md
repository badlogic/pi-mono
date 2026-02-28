# pi-mono 资源加载机制分析报告

## 概述

本文档分析 pi-mono 项目中 `packages/coding-agent` 框架如何加载各类资源，包括：Skill、Extension、Prompt、Agents File 和 System Prompt。

---

## 一、Skill 加载机制

### 加载来源

| 来源 | 路径 | 说明 |
|------|------|------|
| 用户级 | `~/.pi/skills/` | 全局技能，存放在用户配置目录 |
| 项目级 | `{cwd}/.pi/skills/` | 项目本地技能 |
| 指定路径 | CLI 参数传入 | 显式指定的技能路径 |

### 加载流程

```
loadSkills() [skills.ts:355]
├── loadSkillsFromDirInternal(~/.pi/skills, "user")
├── loadSkillsFromDirInternal({cwd}/.pi/skills, "project")
└── loadSkillsFromDirInternal({显式传入的skillPaths})
```

### 优先级与冲突处理

- **优先级**: 显式传入的 `skillPaths` > 项目级 `.pi/skills` > 用户级 `~/.pi/skills`
- **冲突处理**: 使用 Map 按名称存储，后加载的同名技能会覆盖先前的（触发 collision diagnostic 警告）
- **符号链接**: 通过 `realpathSync()` 解析符号链接，避免重复加载同一文件

### 代码入口

```typescript
// packages/coding-agent/src/core/skills.ts:355
export function loadSkills(options: LoadSkillsOptions = {}): LoadSkillsResult
```

---

## 二、Extension 加载机制

### 加载来源

| 来源 | 方式 | 说明 |
|------|------|------|
| 包管理安装 | `pi install <extension>` | 从 npm/git 安装，存放在 `~/.pi/extensions/` |
| 项目级 | `{cwd}/.pi/extensions/` | 项目本地扩展 |
| 运行时 | `extendResources()` API | 动态添加扩展路径 |

### 加载流程

```
DefaultResourceLoader.reload() [resource-loader.ts:307]
├── packageManager.resolveExtensionSources() 
│   └── 从配置读取扩展来源（user/project/temporary）
├── loadExtensions(extensionPaths, cwd, eventBus) [extensions/loader.ts:332]
│   └── 动态导入 .ts/.js 文件，执行 factory 函数
├── loadExtensionFactories() 
│   └── 加载内联扩展（代码中直接定义的）
└── extensionsOverride?(extensionsResult) [resource-loader.ts:130]
    └── 支持通过回调函数修改/过滤扩展
```

### 扩展类型

```typescript
// packages/coding-agent/src/core/extensions/types.ts
interface Extension {
    name: string;
    version?: string;
    tools: Map<string, Tool>;
    commands: Map<string, Command>;
    flags: Map<string, Flag>;
    shortcuts: Map<string, Shortcut>;
    messageRenderers: Map<string, MessageRenderer>;
}
```

### Override 机制

```typescript
// packages/coding-agent/src/core/resource-loader.ts:130
interface ResourceLoaderOptions {
    extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
    // 允许在加载后修改/过滤扩展
}
```

---

## 三、Prompt 加载机制

### 加载来源

| 来源 | 路径 | 说明 |
|------|------|------|
| 用户级 | `~/.pi/prompts/` | 全局提示模板 |
| 项目级 | `{cwd}/.pi/prompts/` | 项目本地提示模板 |
| 指定路径 | CLI 参数传入 | 显式指定的模板路径 |

### Prompt 模板格式

```markdown
---
name: my-template
description: 这是一个模板
---

你是一个${role}，请帮我${task}

参数: $1 (角色), $2 (任务)
```

### 参数替换支持

```typescript
// 支持的替换模式
$1, $2, ...           // 位置参数
$@, $ARGUMENTS        // 所有参数
${@:N}                // 从第N个参数开始
${@:N:L}              // 从第N个开始取L个
```

### 加载流程

```typescript
// packages/coding-agent/src/core/prompt-templates.ts:212
export function loadPromptTemplates(options: LoadPromptTemplatesOptions = {}): PromptTemplate[]
├── loadTemplatesFromDir(~/.pi/prompts/, "user")
├── loadTemplatesFromDir({cwd}/.pi/prompts/, "project")
└── loadTemplatesFromDir({显式传入的promptPaths})
```

### 使用方式

```
/my-template arg1 arg2
```

展开为完整提示后发送给模型。

---

## 四、Agents File 加载机制

### 加载来源

| 来源 | 文件名 | 搜索范围 |
|------|--------|----------|
| 全局 | `AGENTS.md` / `CLAUDE.md` | `~/.pi/` |
| 祖先目录 | `AGENTS.md` / `CLAUDE.md` | 从 cwd 向上遍历到根目录 |
| 项目 | `AGENTS.md` / `CLAUDE.md` | `{cwd}/` |

### 加载流程

```typescript
// packages/coding-agent/src/core/resource-loader.ts:75
function loadProjectContextFiles({ cwd, agentDir })
├── loadContextFileFromDir(~.pi/)        // 全局配置
├── loadContextFileFromDir(cwd)           // 当前目录
├── loadContextFileFromDir(parent)         // 父目录
└── ...向上遍历直到根目录
```

### 优先级

**从当前目录向上搜索，先找到的优先**。所有找到的文件会被合并。

### 文件格式

```markdown
# Agents

## coding-agent
你是专业的代码审查员...
```

---

## 五、System Prompt 加载机制

### 加载来源

| 来源 | 文件名 | 说明 |
|------|--------|------|
| 配置指定 | `systemPrompt` 选项 | 显式传入 |
| 项目文件 | `{cwd}/.pi/SYSTEM.md` | 项目级系统提示 |
| 全局文件 | `~/.pi/SYSTEM.md` | 用户级系统提示 |
| 追加文件 | `{cwd}/.pi/APPEND_SYSTEM.md` | 追加到系统提示末尾 |
| 框架默认 | `buildSystemPrompt()` | 当无其他来源时使用 |

### 优先级

```
1. systemPrompt 选项 (显式传入)
      ↓
2. {cwd}/.pi/SYSTEM.md [resource-loader.ts:742]
      ↓
3. ~/.pi/SYSTEM.md [resource-loader.ts:742]
      ↓
4. buildSystemPrompt() 生成默认提示
```

### 发现文件逻辑

```typescript
// packages/coding-agent/src/core/resource-loader.ts:742
private discoverSystemPromptFile(): string | undefined {
    const projectPath = join(this.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
    if (existsSync(projectPath)) {
        return projectPath;
    }

    const globalPath = join(this.agentDir, "SYSTEM.md");
    if (existsSync(globalPath)) {
        return globalPath;
    }

    return undefined;
}

// packages/coding-agent/src/core/resource-loader.ts:756
private discoverAppendSystemPromptFile(): string | undefined {
    const projectPath = join(this.cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
    if (existsSync(projectPath)) {
        return projectPath;
    }

    const globalPath = join(this.agentDir, "APPEND_SYSTEM.md");
    if (existsSync(globalPath)) {
        return globalPath;
    }

    return undefined;
}
```

### Override 机制

```typescript
// packages/coding-agent/src/core/resource-loader.ts:146
interface ResourceLoaderOptions {
    systemPromptOverride?: (base: string | undefined) => string | undefined;
    appendSystemPromptOverride?: (base: string[]) => string[];
}
```

---

## 六、Agents/Subagent 加载机制

### 6.1 概念区分

pi-mono 中存在两个容易混淆的概念：

| 概念 | 来源 | 用途 |
|------|------|------|
| **Agents File** | `AGENTS.md` / `CLAUDE.md` | 项目上下文配置，嵌入系统提示 |
| **Subagent** | `.pi/agents/*.md` | 可被主 agent 调用的独立子 agent |

**关键区别**：
- Agents File 是**静态配置**，内容直接注入系统提示
- Subagent 是**可执行工具**，通过 `subagent` 工具调用

### 6.2 Agents File 加载

#### 加载来源

| 来源 | 文件名 | 搜索范围 |
|------|--------|----------|
| 全局 | `AGENTS.md` / `CLAUDE.md` | `~/.pi/` |
| 祖先目录 | `AGENTS.md` / `CLAUDE.md` | 从 cwd 向上遍历到根目录 |
| 项目 | `AGENTS.md` / `CLAUDE.md` | `{cwd}/` |

#### 加载流程

```typescript
// packages/coding-agent/src/core/resource-loader.ts:75
function loadProjectContextFiles({ cwd, agentDir })
├── loadContextFileFromDir(~.pi/)        // 全局配置
├── loadContextFileFromDir(cwd)           // 当前目录
├── loadContextFileFromDir(parent)         // 父目录
└── ...向上遍历直到根目录
```

#### 文件格式

```markdown
# Agents

## coding-agent
你是专业的代码审查员...
```

### 6.3 Agents File 如何注入系统提示

#### 流程链

```
AgentSession 初始化
├── resourceLoader.getAgentsFiles() [resource-loader.ts:261]
│   └── 返回 { agentsFiles: [{ path, content }, ...] }
│
├── buildSystemPrompt({ contextFiles: [...] }) [system-prompt.ts:29]
│   └── 将 contextFiles 注入到系统提示
│
└── 系统提示生成 [system-prompt.ts:71-76]
    └── # Project Context
        ## {filePath}
        {content}
```

#### 关键代码

```typescript
// packages/coding-agent/src/core/agent-session.ts:681
const loadedContextFiles = this._resourceLoader.getAgentsFiles().agentsFiles;

// packages/coding-agent/src/core/system-prompt.ts:71-76
if (contextFiles.length > 0) {
    prompt += "\n\n# Project Context\n\n";
    prompt += "Project-specific instructions and guidelines:\n\n";
    for (const { path: filePath, content } of contextFiles) {
        prompt += `## ${filePath}\n\n${content}\n\n`;
    }
}
```

### 6.4 Subagent 扩展机制

`subagent` 是一个 Extension Tool，允许主 agent 调用独立的子 agent 进程。

#### 文件结构

```
.pi/agents/
├── planner.md       # 规划 agent
├── worker.md        # 执行 agent
├── reviewer.md      # 审查 agent
└── scout.md         # 侦察 agent
```

#### Agent 定义格式

```markdown
---
name: planner
description: Creates implementation plans from context and requirements
tools: read, grep, find, ls
model: claude-sonnet-4-5
---

你是规划专家。接收上下文和需求，产生清晰的实现计划。
...
```

### 6.5 Subagent 加载流程

#### 核心函数

```typescript
// packages/coding-agent/examples/extensions/subagent/agents.ts:95
export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult
```

#### 加载来源

| Scope | 用户级目录 | 项目级目录 |
|-------|-----------|-----------|
| `"user"` | `~/.pi/agents/` | ❌ |
| `"project"` | ❌ | `.pi/agents/` (向上搜索) |
| `"both"` | `~/.pi/agents/` | `.pi/agents/` (向上搜索) |

#### 代码流程

```typescript
// 1. 确定搜索目录 [agents.ts:95-97]
const userDir = path.join(getAgentDir(), "agents");           // ~/.pi/agents
const projectAgentsDir = findNearestProjectAgentsDir(cwd);    // 向上搜索 .pi/agents

// 2. 加载用户级 agents [agents.ts:100]
const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");

// 3. 加载项目级 agents [agents.ts:101]
const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

// 4. 合并去重 [agents.ts:103-114]
const agentMap = new Map<string, AgentConfig>();
if (scope === "both") {
    for (const agent of userAgents) agentMap.set(agent.name, agent);
    for (const agent of projectAgents) agentMap.set(agent.name, agent);
}
```

#### Agent 配置解析

```typescript
// packages/coding-agent/examples/extensions/subagent/agents.ts:35-65
function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
    for (const entry of entries) {
        // 解析 frontmatter
        const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
        
        // 提取配置
        agents.push({
            name: frontmatter.name,           // required
            description: frontmatter.description,  // required
            tools: frontmatter.tools?.split(","), // optional: "read,write,edit"
            model: frontmatter.model,           // optional: "claude-sonnet-4-5"
            systemPrompt: body,                 // markdown body 作为 system prompt
            source,                            // "user" | "project"
            filePath,
        });
    }
}
```

### 6.6 Subagent 调用机制

#### 工具注册

```typescript
// packages/coding-agent/examples/extensions/subagent/index.ts:400-415
export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: "subagent",
        label: "Subagent",
        description: "Delegate tasks to specialized subagents...",
        parameters: SubagentParams,
        
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            // 发现可用的 agents
            const discovery = discoverAgents(ctx.cwd, agentScope);
            const agents = discovery.agents;
            // ...
        }
    });
}
```

#### 三种调用模式

##### 1. Single 模式

```typescript
// 单个 agent 执行单个任务
{ agent: "planner", task: "创建一个实现计划" }
```

##### 2. Parallel 模式

```typescript
// 多个 agent 并行执行
{ tasks: [
    { agent: "scout", task: "探索代码结构" },
    { agent: "planner", task: "制定计划" }
]}
```

##### 3. Chain 模式

```typescript
// 顺序执行，输出传递
{ chain: [
    { agent: "scout", task: "探索代码" },
    { agent: "planner", task: "基于以下上下文制定计划:\n{previous}" },
    { agent: "worker", task: "执行计划:\n{previous}" }
]}
```

#### 进程执行

```typescript
// packages/coding-agent/examples/extensions/subagent/index.ts:215-280
async function runSingleAgent(...) {
    // 构建 pi 命令参数
    const args = [
        "--mode", "json",
        "-p",
        "--no-session",
        "--model", agent.model,
        "--tools", agent.tools.join(","),
        "--append-system-prompt", tmpPromptPath,  // agent 的 system prompt
        `Task: ${task}`
    ];
    
    // 启动子进程
    const proc = spawn("pi", args, { cwd, shell: false });
    
    // 实时收集输出
    proc.stdout.on("data", (data) => {
        // 解析 JSON 事件流
        for (const line of lines) {
            const event = JSON.parse(line);
            if (event.type === "message_end") {
                // 收集 usage 和 messages
            }
        }
    });
}
```

### 6.7 完整调用链

```
用户输入
    ↓
主 Agent 处理
    ↓
调用 subagent 工具
    ↓
discoverAgents(cwd, scope) [subagent/agents.ts:95]
    ├── findNearestProjectAgentsDir(cwd)  ← 向上搜索 .pi/agents/
    ├── loadAgentsFromDir(~/.pi/agents/, "user")
    └── loadAgentsFromDir(.pi/agents/, "project")
    ↓
找到目标 agent 配置
    ↓
runSingleAgent() [subagent/index.ts:215]
    ├── 解析 agent.systemPrompt
    ├── 写入临时文件
    ├── spawn("pi", args)  ← 启动子进程
    └── 收集子进程输出
    ↓
返回结果给主 Agent
```

### 6.8 安全机制

#### 项目级 Agent 确认

```typescript
// packages/coding-agent/examples/extensions/subagent/index.ts:455-475
if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
    const projectAgentsRequested = ...;
    
    if (projectAgentsRequested.length > 0) {
        // 弹窗确认
        const ok = await ctx.ui.confirm(
            "Run project-local agents?",
            `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled...`
        );
        
        if (!ok) return { content: [{ type: "text", text: "Canceled..." }] };
    }
}
```

---

## 七、DefaultResourceLoader 架构

### 核心类

```typescript
// packages/coding-agent/src/core/resource-loader.ts:150
export class DefaultResourceLoader implements ResourceLoader {
    private packageManager: DefaultPackageManager;
    private settingsManager: SettingsManager;
    private eventBus: EventBus;
    
    // Override 回调 [resource-loader.ts:130-146]
    private extensionsOverride?: ...;      // line 167
    private skillsOverride?: ...;           // line 168
    private promptsOverride?: ...;           // line 172
    private themesOverride?: ...;
    private agentsFilesOverride?: ...;      // line 180
    private systemPromptOverride?: ...;     // line 183
    private appendSystemPromptOverride?: ...;
    
    // 核心方法
    getExtensions(): LoadExtensionsResult;
    getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
    getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
    getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
    getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
    getSystemPrompt(): string | undefined;
    getAppendSystemPrompt(): string[];
    extendResources(paths: ResourceExtensionPaths): void;
    reload(): Promise<void>;                // line 307
}
```

### 初始化流程

```
DefaultResourceLoader 构造函数 [resource-loader.ts:150]
├── 初始化 packageManager, settingsManager, eventBus
├── 解析 CLI 参数 (extensionPaths, skillPaths, promptPaths, themePaths)
├── 设置 Override 回调 [resource-loader.ts:130-146]
└── 等待 reload() 被调用来加载资源
```

### reload() 流程

```typescript
// packages/coding-agent/src/core/resource-loader.ts:307
async reload(): Promise<void>
├── packageManager.resolve()
├── packageManager.resolveExtensionSources()
├── loadExtensions() - 加载扩展 [extensions/loader.ts:332]
├── loadSkills() - 加载技能 [skills.ts:355]
├── loadPromptTemplates() - 加载提示模板 [prompt-templates.ts:212]
├── loadThemes() - 加载主题
├── loadProjectContextFiles() - 加载 Agents Files [resource-loader.ts:75]
├── discoverSystemPromptFile() - 发现系统提示文件 [resource-loader.ts:742]
├── discoverAppendSystemPromptFile() - 发现追加系统提示文件 [resource-loader.ts:756]
└── 应用所有 Override 回调
```

---

## 八、资源加载优先级总结

### System Prompt

```
systemPrompt选项 > .pi/SYSTEM.md > ~/.pi/SYSTEM.md > buildSystemPrompt()
        ↑                ↑                ↑
   resource-       resource-       resource-
   loader.ts:425   loader.ts:742   loader.ts:742
```

### Skills

```
显式skillPaths > .pi/skills > ~/.pi/skills
        ↑            ↑
   skills.ts     skills.ts
    :355-459     :355-459
```

### Extensions

```
显式扩展路径 > .pi/extensions > packageManager安装 > 内联扩展
        ↑              ↑                  ↑
  resource-      extensions/        extensions/
  loader.ts     loader.ts:332       loader.ts:332
```

### Prompts

```
显式promptPaths > .pi/prompts > ~/.pi/prompts
        ↑            ↑                  ↑
  prompt-        prompt-             prompt-
  templates.ts   templates.ts        templates.ts
    :212           :212                :212
```

### Agents Files

```
cwd -> parent -> ... -> ~/.pi/ (所有找到的合并)
  ↑
resource-loader.ts:75-109
```

---

## 九、Override 回调机制

`DefaultResourceLoader` 支持通过回调函数在资源加载后修改/过滤结果：

```typescript
// packages/coding-agent/src/core/resource-loader.ts:130-146
interface ResourceLoaderOptions {
    // Extensions [line 130]
    extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
    
    // Skills [line 131]
    skillsOverride?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => { ... };
    
    // Prompts [line 135]
    promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => { ... };
    
    // Themes [line 139]
    themesOverride?: (base: { themes: Theme[]; diagnostics: ResourceDiagnostic[] }) => { ... };
    
    // Agents Files [line 143]
    agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => { ... };
    
    // System Prompt [line 146]
    systemPromptOverride?: (base: string | undefined) => string | undefined;
    appendSystemPromptOverride?: (base: string[]) => string[];
}
```

### 使用示例

```typescript
const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    // 禁用所有扩展
    extensionsOverride: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    
    // 修改 System Prompt
    systemPromptOverride: (base) => base ? `${base}\n\n额外指令...` : undefined,
    
    // 过滤 Skills
    skillsOverride: (base) => ({
        ...base,
        skills: base.skills.filter(s => s.name.startsWith("code-"))
    }),
});
```

---

## 十、热重载机制

`DefaultResourceLoader` 支持通过 `reload()` 方法实现资源热重载：

```typescript
// packages/coding-agent/src/core/resource-loader.ts:307
async reload(): Promise<void> {
    // 重新解析包管理器
    const resolvedPaths = await this.packageManager.resolve();
    
    // 重新加载所有资源
    const extensionsResult = await loadExtensions(...);  // extensions/loader.ts:332
    const skillsResult = loadSkills(...);                // skills.ts:355
    const promptsResult = loadPromptTemplates(...);      // prompt-templates.ts:212
    // ...
}
```

通常与文件监听器配合使用：

```typescript
// 监听 .pi 目录变化
watch(".pi", { recursive: true }, () => {
    loader.reload();
});
```

---

## 十一、代码索引

### 核心框架

| 功能 | 文件 | 行号 |
|------|------|------|
| loadSkills 函数 | `packages/coding-agent/src/core/skills.ts` | 355 |
| loadExtensions 函数 | `packages/coding-agent/src/core/extensions/loader.ts` | 332 |
| loadPromptTemplates 函数 | `packages/coding-agent/src/core/prompt-templates.ts` | 212 |
| loadProjectContextFiles 函数 | `packages/coding-agent/src/core/resource-loader.ts` | 75 |
| discoverSystemPromptFile 方法 | `packages/coding-agent/src/core/resource-loader.ts` | 742 |
| discoverAppendSystemPromptFile 方法 | `packages/coding-agent/src/core/resource-loader.ts` | 756 |
| DefaultResourceLoader 类 | `packages/coding-agent/src/core/resource-loader.ts` | 150 |
| reload 方法 | `packages/coding-agent/src/core/resource-loader.ts` | 307 |
| ResourceLoader 接口 | `packages/coding-agent/src/core/resource-loader.ts` | 23-34 |
| Override 选项定义 | `packages/coding-agent/src/core/resource-loader.ts` | 130-146 |
| buildSystemPrompt 函数 | `packages/coding-agent/src/core/system-prompt.ts` | 38 |

### Agents / Subagent 扩展

| 功能 | 文件 | 行号 |
|------|------|------|
| discoverAgents 函数 | `packages/coding-agent/examples/extensions/subagent/agents.ts` | 95 |
| findNearestProjectAgentsDir 函数 | `packages/coding-agent/examples/extensions/subagent/agents.ts` | 82 |
| loadAgentsFromDir 函数 | `packages/coding-agent/examples/extensions/subagent/agents.ts` | 26 |
| subagent 工具注册 | `packages/coding-agent/examples/extensions/subagent/index.ts` | 400 |
| runSingleAgent 函数 | `packages/coding-agent/examples/extensions/subagent/index.ts` | 215 |
| 并发限制执行 | `packages/coding-agent/examples/extensions/subagent/index.ts` | 195 |
| 项目级 Agent 确认 | `packages/coding-agent/examples/extensions/subagent/index.ts` | 455 |
