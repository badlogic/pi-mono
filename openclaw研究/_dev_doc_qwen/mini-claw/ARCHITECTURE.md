# Mini-Claw 架构文档

## 概述

Mini-Claw 是一个基于 pi-mono 理念构建的最小化 AI 编码助手。它剥离了 OpenClaw 的复杂扩展层，只保留核心功能。

## 设计原则

1. **最小化**: 只保留核心工具 (bash, read, write, edit, glob)
2. **简单性**: 单一配置文件，无需网关层
3. **信任模式**: 假设单用户使用，无沙箱隔离
4. **多提供商**: 支持 Anthropic 和 OpenAI

## 架构层次

```
┌─────────────────────────────────────────┐
│              CLI (cli.py)                │
│   - 交互式 REPL / 单命令模式             │
│   - 配置管理 / 初始化向导                │
├─────────────────────────────────────────┤
│            Agent (agent.py)              │
│   - 代理循环 / 工具执行 / 会话管理       │
├─────────────────────────────────────────┤
│             LLM (llm.py)                 │
│   - 提供商抽象 / Anthropic / OpenAI      │
├─────────────────────────────────────────┤
│            Tools (tools.py)              │
│   - bash / read / write / edit / glob    │
├─────────────────────────────────────────┤
│          Config (config.py)              │
│   - 配置加载 / 保存 / 环境变量           │
└─────────────────────────────────────────┘
```

## 核心模块

### config.py - 配置管理

- `Config`: Pydantic 模型，定义配置结构
- `ConfigManager`: 加载/保存配置，支持文件和环境变量

### tools.py - 工具系统

5 个核心工具:
- `bash(command)`: 执行 shell 命令
- `read(path)`: 读取文件
- `write(path, content)`: 写入文件
- `edit(path, old_text, new_text)`: 编辑文件
- `glob(pattern)`: 文件搜索

### llm.py - LLM 抽象

- `BaseLLM`: 抽象基类
- `AnthropicLLM`: Anthropic Claude API 实现
- `OpenAILLM`: OpenAI API 实现
- `create_llm()`: 工厂函数

### agent.py - 代理循环

- `Agent`: 核心代理类
  - `run()`: 执行代理循环
  - `_execute_tool()`: 工具执行
  - `_build_system_prompt()`: 系统提示生成
- `AgentResult`: 代理运行结果
- `run_agent()`: 便捷函数

### cli.py - 命令行界面

- `main()`: CLI 入口点
- `interactive_mode()`: 交互式 REPL
- `run_command()`: 单命令模式
- `init_config_interactive()`: 配置向导

## 数据流

```
用户输入 → CLI → Agent.run() → LLM.chat()
                              ↓
                         检测工具调用
                              ↓
                    Agent._execute_tool()
                              ↓
                        执行工具 (tools.py)
                              ↓
                         结果返回 LLM
                              ↓
                    重复直到最终响应
                              ↓
                    返回结果给用户
```

## 与 OpenClaw 对比

| 特性 | OpenClaw | Mini-Claw |
|------|----------|-----------|
| 代码量 | ~50,000 行 | ~1,000 行 |
| 文件数 | 500+ | 6 |
| 依赖 | 80+ | 5 |
| 渠道集成 | 15+ | 0 |
| 网关层 | ✓ | ✗ |
| 插件系统 | ✓ | ✗ |
| 技能系统 | ✓ | ✗ |
| 沙箱执行 | ✓ | ✗ |
| 多代理 | ✓ | ✗ |
| 核心工具 | 50+ | 5 |

## 扩展方向

如需扩展功能，可添加:

1. **新工具**: 在 `tools.py` 中添加函数，更新 `TOOLS` 字典
2. **新 LLM 提供商**: 在 `llm.py` 中实现 `BaseLLM` 子类
3. **自定义系统提示**: 通过 `system_prompt` 参数传入
4. **会话持久化**: 扩展 `Agent` 类添加保存/加载功能

## 使用示例

### 编程方式

```python
from miniclaw.agent import run_agent

result = await run_agent(
    message="Create a hello.py file",
    provider="anthropic",
    api_key="sk-ant-...",
    workspace="/path/to/project",
)
print(result.response)
```

### CLI 方式

```bash
# 交互式
mini-claw

# 单命令
mini-claw "List Python files"

# 指定工作区
mini-claw -w /path/to/project "Add tests"
```

## 安全考虑

当前版本采用**信任模式**:
- 无沙箱隔离
- 工具可直接执行命令和修改文件
- 建议仅在可信环境中使用

生产环境可考虑:
- 添加命令白名单
- 实现执行前确认
- 添加文件操作审计日志
