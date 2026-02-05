#!/usr/bin/env pwsh
#
# Build pi binaries for all platforms locally.
# Mirrors .github/workflows/build-binaries.yml
#
# Usage:
#   .\scripts\build-windows.ps1 [-SkipDeps] [-Platform <platform>]

#e.g. 

# Build for all platforms
#.\scripts\build-windows.ps1

# Build for specific platform and skip dependencies
#.\scripts\build-windows.ps1 -Platform windows-x64 -SkipDeps

param (
    [switch]$SkipDeps,
    [string]$Platform = ""
)

$ErrorActionPreference = "Stop"

# Navigate to project root
Set-Location "$PSScriptRoot/.."

# Validate platform if specified
if (-not [string]::IsNullOrEmpty($Platform)) {
    $ValidPlatforms = "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"
    if ($ValidPlatforms -notcontains $Platform) {
        Write-Error "Invalid platform: $Platform"
        Write-Host "Valid platforms: $($ValidPlatforms -join ', ')"
        exit 1
    }
}

Write-Host "==> Installing dependencies..."
npm ci

if (-not $SkipDeps) {
    Write-Host "==> Installing cross-platform native bindings..."
    # npm ci only installs optional deps for the current platform
    # We need all platform bindings for bun cross-compilation
    npm install --no-save --force `
        @mariozechner/clipboard-darwin-arm64@0.3.0 `
        @mariozechner/clipboard-darwin-x64@0.3.0 `
        @mariozechner/clipboard-linux-x64-gnu@0.3.0 `
        @mariozechner/clipboard-linux-arm64-gnu@0.3.0 `
        @mariozechner/clipboard-win32-x64-msvc@0.3.0 `
        @img/sharp-darwin-arm64@0.34.5 `
        @img/sharp-darwin-x64@0.34.5 `
        @img/sharp-linux-x64@0.34.5 `
        @img/sharp-linux-arm64@0.34.5 `
        @img/sharp-win32-x64@0.34.5 `
        @img/sharp-libvips-darwin-arm64@1.2.4 `
        @img/sharp-libvips-darwin-x64@1.2.4 `
        @img/sharp-libvips-linux-x64@1.2.4 `
        @img/sharp-libvips-linux-arm64@1.2.4
}
else {
    Write-Host "==> Skipping cross-platform native bindings (-SkipDeps)"
}

Write-Host "==> Building all packages..."
npm run build

Write-Host "==> Building binaries..."
Set-Location "packages/coding-agent"

# Clean previous builds
if (Test-Path "binaries") {
    Remove-Item "binaries" -Recurse -Force
}
New-Item -ItemType Directory -Force -Path "binaries" | Out-Null

$AllPlatforms = @("darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64")
if (-not [string]::IsNullOrEmpty($Platform)) {
    $TargetPlatforms = @($Platform)
}
else {
    $TargetPlatforms = $AllPlatforms
}

foreach ($p in $TargetPlatforms) {
    New-Item -ItemType Directory -Force -Path "binaries/$p" | Out-Null
}

foreach ($p in $TargetPlatforms) {
    Write-Host "Building for $p..."
    $OutFile = "binaries/$p/pi"
    if ($p -eq "windows-x64") {
        $OutFile += ".exe"
    }
    
    bun build --compile --target=bun-$p ./dist/cli.js --outfile $OutFile
}

Write-Host "==> Creating release archives..."

# Copy shared files
foreach ($p in $TargetPlatforms) {
    Copy-Item "package.json" "binaries/$p/"
    Copy-Item "README.md" "binaries/$p/"
    Copy-Item "CHANGELOG.md" "binaries/$p/"
    Copy-Item "../../node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm" "binaries/$p/"
    
    New-Item -ItemType Directory -Force -Path "binaries/$p/theme" | Out-Null
    Copy-Item "dist/modes/interactive/theme/*.json" "binaries/$p/theme/"
    
    Copy-Item -Recurse "dist/core/export-html" "binaries/$p/"
    Copy-Item -Recurse "docs" "binaries/$p/"
    Copy-Item -Recurse "examples" "binaries/$p/"
}

# Create archives
Set-Location "binaries"

foreach ($p in $TargetPlatforms) {
    if ($p -eq "windows-x64") {
        Write-Host "Creating pi-$p.zip..."
        # Windows zip: contents at root of zip
        Compress-Archive -Path "$p/*" -DestinationPath "pi-$p.zip" -Force
    }
    else {
        Write-Host "Creating pi-$p.tar.gz..."
        # Unix platforms (tar.gz) - use wrapper directory for mise compatibility
        Rename-Item $p "pi"
        try {
            # Windows tar.exe supports gz
            tar -czf "pi-$p.tar.gz" "pi"
        }
        finally {
            Rename-Item "pi" $p
        }
    }
}

# Extract for testing
Write-Host "==> Extracting archives for testing..."
foreach ($p in $TargetPlatforms) {
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
    
    if ($p -eq "windows-x64") {
        New-Item -ItemType Directory -Force -Path $p | Out-Null
        Expand-Archive -Path "pi-$p.zip" -DestinationPath $p -Force
    }
    else {
        tar -xzf "pi-$p.tar.gz"
        if (Test-Path "pi") {
            Rename-Item "pi" $p
        }
    }
}

Write-Host ""
Write-Host "==> Build complete!"
Write-Host "Archives available in packages/coding-agent/binaries/"
Get-ChildItem -Include *.tar.gz, *.zip -Recurse | Select-Object Name, Length
Write-Host ""
Write-Host "Extracted directories for testing:"
foreach ($p in $TargetPlatforms) {
    Write-Host "  binaries/$p/pi"
}
