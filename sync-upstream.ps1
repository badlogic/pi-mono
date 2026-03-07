$ErrorActionPreference = "Stop"

# pi-mono 与上游同步脚本
# 用法: .\sync-upstream.ps1 [-Force]

param(
    [switch]$Force
)

$UpstreamRepo = "https://github.com/badlogic/pi-mono.git"
$UpstreamBranch = "main"

Write-Host "=== 开始同步 pi-mono 上游 ===" -ForegroundColor Cyan

# 1. 检查 upstream 是否已配置
$upstreamExists = $false
try {
    $null = git remote get-url upstream
    $upstreamExists = $true
} catch {
    $upstreamExists = $false
}

if (-not $upstreamExists) {
    Write-Host "[1/6] 添加 upstream 远程仓库..." -ForegroundColor Yellow
    git remote add upstream $UpstreamRepo
} else {
    Write-Host "[1/6] upstream 已存在，跳过添加" -ForegroundColor Green
}

# 2. 获取上游最新代码
Write-Host "[2/6] 获取上游最新代码..." -ForegroundColor Yellow
git fetch upstream

# 3. 检查当前分支
$currentBranch = git branch --show-current
Write-Host "[3/6] 当前分支: $currentBranch" -ForegroundColor Cyan

# 4. 检查是否有未提交的更改
$status = git status --porcelain
if ($status -and -not $Force) {
    Write-Host "[!] 警告: 有未提交的更改" -ForegroundColor Red
    Write-Host "请先提交或暂存更改，或使用 -Force 强制继续" -ForegroundColor Yellow
    git status
    exit 1
}

# 5. 执行 rebase
Write-Host "[4/6] 执行 rebase 到 upstream/$UpstreamBranch..." -ForegroundColor Yellow

$rebaseResult = git rebase "upstream/$UpstreamBranch" 2>&1
$rebaseExitCode = $LASTEXITCODE

if ($rebaseExitCode -eq 0) {
    Write-Host "[+] rebase 完成" -ForegroundColor Green

    # 6. 推送更改
    Write-Host "[5/6] 推送更改到 origin..." -ForegroundColor Yellow
    $pushResult = git push --force-with-lease 2>&1
    $pushExitCode = $LASTEXITCODE

    if ($pushExitCode -eq 0) {
        Write-Host "[+] 推送完成" -ForegroundColor Green
    } else {
        Write-Host "[!] 推送失败" -ForegroundColor Red
        Write-Host $pushResult
    }
} else {
    Write-Host "[!] rebase 遇到冲突" -ForegroundColor Red

    # 查找冲突文件
    $conflicts = git status --porcelain | Where-Object { $_ -match "^UU" }
    if ($conflicts) {
        Write-Host "冲突文件:" -ForegroundColor Yellow
        $conflicts | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    }

    Write-Host ""
    Write-Host "请手动解决冲突后，运行以下命令继续:" -ForegroundColor Cyan
    Write-Host "  git add <冲突文件>" -ForegroundColor White
    Write-Host "  git rebase --continue" -ForegroundColor White
    Write-Host ""
    Write-Host "或中止 rebase:" -ForegroundColor Cyan
    Write-Host "  git rebase --abort" -ForegroundColor White

    exit 1
}

Write-Host ""
Write-Host "=== 同步完成 ===" -ForegroundColor Cyan
Write-Host "最新提交: $(git log --oneline -1)" -ForegroundColor White