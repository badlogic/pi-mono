#!/bin/bash
# pi-mono 与上游同步脚本
# 用法: ./sync-upstream.sh [--force]

set -e

UPSTREAM_REPO="https://github.com/badlogic/pi-mono.git"
UPSTREAM_BRANCH="main"
FORCE=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE=true
            shift
            ;;
        *)
            echo "未知参数: $1"
            echo "用法: $0 [--force]"
            exit 1
            ;;
    esac
done

echo "=== 开始同步 pi-mono 上游 ==="

# 1. 检查 upstream 是否已配置
if ! git remote get-url upstream >/dev/null 2>&1; then
    echo "[1/6] 添加 upstream 远程仓库..."
    git remote add upstream "$UPSTREAM_REPO"
else
    echo "[1/6] upstream 已存在，跳过添加"
fi

# 2. 获取上游最新代码
echo "[2/6] 获取上游最新代码..."
git fetch upstream

# 3. 检查当前分支
CURRENT_BRANCH=$(git branch --show-current)
echo "[3/6] 当前分支: $CURRENT_BRANCH"

# 4. 检查是否有未提交的更改
if [[ -n $(git status --porcelain) ]]; then
    echo "[!] 警告: 有未提交的更改"
    if [[ "$FORCE" == "false" ]]; then
        echo "请先提交或暂存更改，或使用 --force 强制继续"
        git status
        exit 1
    fi
fi

# 5. 执行 rebase
echo "[4/6] 执行 rebase 到 upstream/$UPSTREAM_BRANCH..."
if git rebase "upstream/$UPSTREAM_BRANCH"; then
    echo "[+] rebase 完成"
else
    echo "[!] rebase 遇到冲突"
    echo "冲突文件:"
    git status --porcelain | grep "^UU" || true

    echo ""
    echo "请手动解决冲突后，运行以下命令继续:"
    echo "  git add <冲突文件>"
    echo "  git rebase --continue"
    echo ""
    echo "或中止 rebase:"
    echo "  git rebase --abort"
    exit 1
fi
