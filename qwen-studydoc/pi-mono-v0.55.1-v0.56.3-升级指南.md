# pi-mono 从 v0.55.1 升级到 v0.56.3 指南

## 1. 版本对比

| 特性 | v0.55.1 | v0.56.3 |
|------|---------|---------|
| **最新版本** | v0.55.1 (2025-11-27) | v0.56.3 (2026-03-06) |
| **主要变化** | 基础功能 | 11 个版本迭代，包含新功能和修复 |

## 2. 主要变化

### 2.1 新功能

#### v0.56.3
- `claude-sonnet-4-6` 模型支持（通过 google-antigravity 提供商）
- 自定义编辑器可以定义自己的 `onEscape`/`onCtrlD` 处理器
- tmux 中 Shift+Enter 和 Ctrl+Enter 支持
- 自动压缩对持久 API 错误（如 529 过载）的弹性处理

#### v0.56.2
- GPT-5.4 支持（openai, openai-codex, azure-openai-responses, opencode）
- `treeFilterMode` 设置（default, no-tools, user-only, labeled-only, all）
- Mistral 原生对话集成

#### v0.56.1
- 无重大变化

#### v0.56.0
- OpenCode Go 提供商支持（opencode-go 模型）
- `branchSummary.skipPrompt` 设置
- gemini-3.1-flash-lite-preview 回退模型
- **Breaking Change**: 作用域模型思考语义变更
- **Breaking Change**: Node OAuth 运行时导出移至 `@mariozechner/pi-ai/oauth`

#### v0.55.4
- 运行时工具注册立即生效
- 自定义工具可以定义 `promptSnippet` 和 `promptGuidelines`

#### v0.55.3
- Windows 上图像粘贴键绑定更改为 `alt+v`

#### v0.55.2
- 动态删除自定义提供商支持
- 动态注册提供商立即生效

### 2.2 修复的重要问题

#### v0.56.3
- 修复自定义编辑器的 `onEscape`/`onCtrlD` 处理器被无条件覆盖的问题
- 修复自动压缩在第一次提示后重新触发的问题
- 修复持久 API 错误时会话永不自动压缩的问题
- 修复压缩摘要请求超出上下文限制的问题
- 修复 `/new` 保留启动页眉内容的问题
- 修复工具执行错误标记的误导性文档
- 修复模型切换通过非推理模型时的思考级别问题
- 修复并行 pi 进程的锁文件争用问题
- 修复 OpenAI Responses 推理重放回归问题

#### v0.56.2
- 修复 GPT-5.3 Codex 后续轮次丢失 OpenAI Responses 助手阶段元数据的问题
- 修复 OpenAI Responses 重放时省略空思考块的问题
- 更新 Mistral 集成以使用原生 SDK 支持的提供商和对话 API
- 修复 Antigravity 可靠性问题
- 修复 @mariozechner/pi-ai/oauth 扩展导入问题
- 修复 Gemini 3 多轮工具调用丢失结构化上下文的问题
- 修复模型选择器过滤器在 VS Code 1.110+ 中的问题
- 修复终端调整大小期间的编辑器/页脚可见性偏移问题
- 修复宽 Unicode 文本的页脚宽度截断问题
- 修复 Windows 写入预览背景伪影问题

#### v0.56.1
- 修复扩展别名回退解析问题
- 修复 markdown 块引用渲染问题

#### v0.56.0
- 修复 IME 硬件光标定位问题
- 添加 OSC 133 语义区域标记
- 修复 markdown 块引用丢失嵌套列表内容的问题
- 修复 TUI 宽度处理问题
- 修复 Kitty CSI-u 处理问题
- 修复单行粘贴处理问题
- 修复扩展加载问题
- 修复浏览器安全提供商加载回归问题
- 修复 GNU screen 终端检测问题
- 修复分支摘要队列处理问题
- 修复压缩摘要请求问题
- 修复溢出自动压缩级联问题
- 修复 models.json 问题
- 修复会话选择器显示清理问题
- 修复 Groq Qwen3 推理工作映射问题
- 修复 Bedrock AWS_PROFILE 区域解析问题
- 修复 Gemini 3.1 思考级别检测问题
- 修复浏览器捆绑兼容性问题

#### v0.55.4
- 修复动态注册工具问题
- 修复会话消息持久化排序问题
- 修复自定义工具渲染器的间距伪影问题
- 修复 session.prompt() 返回问题

#### v0.55.3
- 修复 Windows 上图像粘贴键绑定问题

#### v0.55.2
- 修复动态删除提供商问题
- 修复动态注册提供商问题
- 修复重复会话标题问题
- 修复 SIGINT 传递问题
- 修复 Z.ai 思考控制问题
- 修复 redacted_thinking 块问题
- 修复 user-agent 标志问题
- 修复空 choices 数组问题

#### v0.55.1
- 修复离线启动挂起问题
- 修复 Windows VT 输入初始化问题
- 修复 Windows 上 managed fd/rg 引导问题
- 修复 Windows 上扩展加载问题
- 修复 Claude Sonnet 4.6 自适应思考问题
- 修复 Vertex ADC 凭证检测竞争问题
- 修复 subagent 扩展示例问题

## 3. 升级注意事项

### 3.1 破坏性变更（Breaking Changes）

#### v0.56.0
1. **资源优先级变更**
   - **变更**：扩展、技能、提示、主题和斜杠命令名称冲突的资源优先级现在是项目优先（cwd/.pi）在用户全局（~/.pi/agent）之前
   - **影响**：如果您依赖全局资源覆盖项目资源，请重命名或重新排序您的资源
   - **迁移**：检查是否有名称冲突的资源，重命名或重新组织

2. **作用域模型思考语义变更**
   - **变更**：没有显式 `:<thinking>` 后缀的范围条目现在继承当前会话思考级别，而不是应用启动时捕获的默认值
   - **影响**：现有配置的思考级别行为可能改变
   - **迁移**：检查并更新作用域模型配置，添加显式 `:<thinking>` 后缀

3. **OAuth 导出路径变更**
   - **变更**：Node OAuth 运行时导出移至 `@mariozechner/pi-ai/oauth`
   - **影响**：使用 OAuth 功能的扩展需要更新导入路径
   - **迁移**：
     ```typescript
     // 旧版本
     import { oauthLogin } from "@mariozechner/pi-ai";
     
     // 新版本
     import { oauthLogin } from "@mariozechner/pi-ai/oauth";
     ```

#### v0.55.0
1. **资源优先级变更**
   - **变更**：扩展、技能、提示、主题和斜杠命令名称冲突的资源优先级现在是项目优先（cwd/.pi）在用户全局（~/.pi/agent）之前
   - **影响**：如果您依赖全局资源覆盖项目资源，请重命名或重新排序您的资源
   - **迁移**：检查是否有名称冲突的资源，重命名或重新组织

2. **扩展注册冲突处理变更**
   - **变更**：扩展注册冲突不再卸载整个后续扩展。所有扩展保持加载，冲突的命令/工具/标志名称通过加载顺序中的第一个注册解决
   - **影响**：扩展冲突处理行为改变
   - **迁移**：检查扩展冲突，必要时重命名

### 3.2 API 变更

#### 工具执行错误处理
- **变更**：返回 `{ isError: true }` 不再标记工具执行失败
- **影响**：工具扩展需要更新错误处理
- **迁移**：
  ```typescript
  // 旧版本
  return { content: [...], isError: true };
  
  // 新版本
  throw new Error("Tool execution failed");
  ```

#### 动态工具注册
- **变更**：运行时工具注册现在立即在活动会话中应用
- **影响**：无需 `/reload` 即可使用新注册的工具
- **迁移**：无需更改，但可以移除 `/reload` 调用

#### 动态提供商注册
- **变更**：`pi.registerProvider()` 现在在初始扩展加载阶段后立即生效
- **影响**：无需 `/reload` 即可使用新注册的提供商
- **迁移**：无需更改，但可以移除 `/reload` 调用

### 3.3 配置变更

#### treeFilterMode 设置
- **新增**：`treeFilterMode` 设置（default, no-tools, user-only, labeled-only, all）
- **迁移**：在 `.pi/settings.json` 中添加：
  ```json
  {
    "treeFilterMode": "default"
  }
  ```

#### branchSummary.skipPrompt 设置
- **新增**：`branchSummary.skipPrompt` 设置
- **迁移**：在 `.pi/settings.json` 中添加：
  ```json
  {
    "branchSummary": {
      "skipPrompt": false
    }
  }
  ```

#### thinkingLevel 作用域变更
- **变更**：作用域模型现在继承当前会话思考级别
- **迁移**：检查 `.pi/settings.json` 中的作用域模型配置：
  ```json
  {
    "models": {
      "openai": {
        "gpt-4": "off",
        "gpt-4o": "medium"
      }
    }
  }
  ```

### 3.4 扩展更新

#### OAuth 导入路径
```typescript
// 旧版本
import { oauthLogin } from "@mariozechner/pi-ai";

// 新版本
import { oauthLogin } from "@mariozechner/pi-ai/oauth";
```

#### 工具定义更新
```typescript
// 新增 promptSnippet 和 promptGuidelines
pi.registerTool({
  name: "my-tool",
  description: "My tool",
  promptSnippet: "One-line description for available tools section",
  promptGuidelines: [
    "Tool-specific guideline 1",
    "Tool-specific guideline 2"
  ],
  parameters: Type.Object({...}),
  async execute(...) {...}
});
```

### 3.5 模型变更

#### 默认模型变更
- **v0.56.2**：`openai` 和 `openai-codex` 提供商的默认模型更改为 `gpt-5.4`
- **迁移**：如果需要使用旧模型，请在 `.pi/settings.json` 中指定：
  ```json
  {
    "models": {
      "openai": "gpt-5.1"
    }
  }
  ```

#### 新增模型
- **v0.56.3**：`claude-sonnet-4-6`（google-antigravity）
- **v0.56.2**：`gpt-5.4`（openai, openai-codex, azure-openai-responses, opencode）
- **v0.56.2**：`gpt-5.3-codex`（github-copilot 回退）
- **v0.56.0**：`opencode-go`（OpenCode Go）
- **v0.56.0**：`gemini-3.1-flash-lite-preview`（google-gemini-cli 回退）

### 3.6 破坏性变更检查清单

| 变更 | 是否影响 | 迁移步骤 |
|------|----------|----------|
| 资源优先级 | 是 | 检查名称冲突，重命名或重新组织 |
| 作用域模型思考语义 | 是 | 添加显式 `:<thinking>` 后缀 |
| OAuth 导出路径 | 是 | 更新导入路径 |
| 工具执行错误处理 | 是 | 使用 `throw` 而不是 `{ isError: true }` |
| 扩展注册冲突 | 否 | 无需迁移 |
| 动态工具注册 | 否 | 无需迁移 |
| 动态提供商注册 | 否 | 无需迁移 |

## 4. 升级步骤

### 4.1 备份

```bash
# 备份配置文件
cp -r ~/.pi ~/.pi.backup
cp -r .pi .pi.backup
```

### 4.2 更新 pi-mono

```bash
# 使用 npm
npm update @mariozechner/pi-coding-agent

# 或使用 bun
bun update @mariozechner/pi-coding-agent
```

### 4.3 检查扩展

```bash
# 检查扩展是否需要更新
ls ~/.pi/agent/extensions/
```

### 4.4 更新扩展

```typescript
// 扩展示例：更新 OAuth 导入
import { oauthLogin } from "@mariozechner/pi-ai/oauth";
```

### 4.5 更新配置

```bash
# 检查 .pi/settings.json
cat .pi/settings.json
```

### 4.6 测试

```bash
# 测试 pi 命令
pi --version

# 测试基本功能
pi --help
```

## 5. 常见问题

### 5.1 扩展冲突

**问题**：扩展注册冲突导致功能丢失

**解决方案**：
- 检查扩展名称是否冲突
- 重命名扩展
- 或调整扩展加载顺序

### 5.2 工具执行失败

**问题**：工具执行返回 `{ isError: true }` 不再标记失败

**解决方案**：
```typescript
// 旧版本
return { content: [...], isError: true };

// 新版本
throw new Error("Tool execution failed");
```

### 5.3 OAuth 功能丢失

**问题**：OAuth 功能在更新后丢失

**解决方案**：
```typescript
// 旧版本
import { oauthLogin } from "@mariozechner/pi-ai";

// 新版本
import { oauthLogin } from "@mariozechner/pi-ai/oauth";
```

### 5.4 模型行为改变

**问题**：模型思考级别行为改变

**解决方案**：
- 检查作用域模型配置
- 添加显式 `:<thinking>` 后缀
- 或更新会话思考级别

### 5.5 资源优先级改变

**问题**：全局资源不再覆盖项目资源

**解决方案**：
- 重命名全局资源
- 或使用项目资源
- 或调整资源优先级

## 6. 推荐升级路径

### 6.1 直接升级（推荐）

```bash
# 1. 备份
cp -r ~/.pi ~/.pi.backup
cp -r .pi .pi.backup

# 2. 更新
npm update @mariozechner/pi-coding-agent

# 3. 检查
pi --version

# 4. 测试
pi --help
```

### 6.2 逐步升级

如果担心破坏性变更，可以逐步升级：

```bash
# 1. 升级到 v0.55.2
npm install @mariozechner/pi-coding-agent@0.55.2

# 2. 测试
pi --version
pi --help

# 3. 升级到 v0.55.3
npm install @mariozechner/pi-coding-agent@0.55.3

# 4. 测试
pi --version
pi --help

# 5. 继续升级到 v0.56.3
```

### 6.3 回滚

如果升级后出现问题：

```bash
# 回滚到 v0.55.1
npm install @mariozechner/pi-coding-agent@0.55.1

# 恢复配置
rm -rf ~/.pi
cp -r ~/.pi.backup ~/.pi
```

## 7. 性能改进

### 7.1 并行工具调用

- **改进**：更高效的工具调用执行
- **影响**：更快的工具执行速度

### 7.2 自动压缩

- **改进**：对持久 API 错误的弹性处理
- **影响**：更稳定的自动压缩

### 7.3 上下文管理

- **改进**：更精确的上下文限制处理
- **影响**：更少的上下文溢出错误

## 8. 新功能使用

### 8.1 GPT-5.4

```typescript
// 在 .pi/settings.json 中
{
  "models": {
    "openai": "gpt-5.4"
  }
}
```

### 8.2 treeFilterMode

```typescript
// 在 .pi/settings.json 中
{
  "treeFilterMode": "default"
}
```

### 8.3 自定义编辑器

```typescript
// 在扩展中
ctx.ui.editor({
  onEscape: () => {
    // 自定义 escape 处理
  },
  onCtrlD: () => {
    // 自定义 ctrl+d 处理
  }
});
```

### 8.4 动态工具注册

```typescript
// 在扩展中
pi.registerTool({
  name: "my-tool",
  description: "My tool",
  async execute(...) {...}
});

// 工具立即可用，无需 /reload
```

## 9. 总结

### 9.1 主要变化

| 类别 | 变化数量 |
|------|----------|
| 新功能 | 15+ |
| 修复 | 50+ |
| 破坏性变更 | 5 |

### 9.2 升级风险

| 风险级别 | 说明 |
|----------|------|
| 低 | 大多数变更向后兼容 |
| 中 | OAuth 导入路径变更 |
| 高 | 工具执行错误处理变更 |

### 9.3 推荐操作

1. **备份配置**：升级前备份 `.pi` 和 `~/.pi`
2. **检查扩展**：更新扩展以使用新 API
3. **测试功能**：升级后测试所有功能
4. **监控日志**：升级后监控日志以发现问题

## 10. 参考资料

- [pi-mono GitHub Releases](https://github.com/badlogic/pi-mono/releases)
- [pi-mono 文档](https://github.com/badlogic/pi-mono/tree/main/docs)
- [扩展文档](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
- [技能文档](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/skills)