# Pi Git Clone 研究

## 当前状态

**Pi (coding-agent) 没有专门的 git 工具**。

但是有几种方式可以实现 clone github repo 并分析：

## 方案

### 1. 使用 bash 工具 (推荐，最简单)

Pi 自带 `bash` 工具，可以直接执行 `git clone` 命令：

```bash
git clone https://github.com/user/repo.git
```

然后使用 `@` 引用文件或 `read` 工具分析代码。

**示例对话：**
```
用户: clone https://github.com/facebook/react 然后分析它的目录结构

模型会:
1. 执行 bash: git clone https://github.com/facebook/react
2. 执行 ls 或 find 分析目录结构
3. 使用 read/grep 工具分析代码
```

### 2. 创建 Git Clone Skill

创建 `~/.pi/agent/skills/git-clone/SKILL.md`:

```markdown
# Git Clone Skill

Use this skill when the user asks to clone a GitHub repository and analyze it.

## Steps

1. Ask for the GitHub repository URL if not provided
2. Use bash tool to clone the repository:
   ```
   git clone <repo-url>
   ```
3. Navigate into the cloned directory
4. Analyze the repository structure using ls, find, or tree commands
5. Read key files to understand the codebase
```

使用方式: `/skill:git-clone` 或让模型自动加载

### 3. 创建 Extension 添加专门的 Git 工具

可以创建一个 extension 来添加专门的 `git_clone` 工具：

```typescript
// ~/.pi/agent/extensions/git-clone.ts
import { Type } from "@sinclair/typebox";
import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

export default function (pi) {
  pi.registerTool({
    name: "git_clone",
    description: "Clone a GitHub repository to the current directory",
    parameters: Type.Object({
      url: Type.String({ description: "GitHub repository URL" }),
      directory: Type.Optional(Type.String({ description: "Target directory name" })),
    }),
    execute: async ({ url, directory }) => {
      const targetDir = directory || url.split("/").pop()?.replace(".git", "") || "repo";
      
      if (existsSync(targetDir)) {
        return { success: true, message: `Directory ${targetDir} already exists` };
      }
      
      execSync(`git clone ${url} ${targetDir}`, { stdio: "inherit" });
      return { success: true, message: `Cloned to ${targetDir}`, path: targetDir };
    },
  });
}
```

然后在 `~/.pi/agent/settings.json` 中启用：

```json
{
  "extensions": ["./extensions/git-clone.ts"]
}
```

### 4. 使用 Pi Packages 安装

Pi 支持通过 `pi install` 安装 git 仓库作为 packages (用于扩展 pi 本身的功能)，但这不是用来 clone 任意仓库分析的。

## 推荐的简单方法

直接告诉 pi：

```
clone https://github.com/facebook/react and analyze its structure
```

Pi 会使用 bash 工具自动执行 clone，然后用 ls/find/read 工具分析。

## 注意事项

1. **权限**: bash 工具执行 git clone 需要系统已安装 git
2. **工作目录**: 默认 clone 到当前工作目录，可以 cd 进 clone 的目录
3. **大仓库**: 对于大型仓库，clone 可能需要较长时间
