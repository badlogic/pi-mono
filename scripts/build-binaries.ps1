param(
	[switch]$SkipDeps,
	[ValidateSet("", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64")]
	[string]$Platform = ""
)

$ErrorActionPreference = "Stop"

function Run-Command {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Exe,
		[string[]]$Args = @()
	)

	& $Exe @Args
	if ($LASTEXITCODE -ne 0) {
		throw "Command failed: $Exe $($Args -join ' ')"
	}
}

$repoRoot = Join-Path $PSScriptRoot ".."
Set-Location $repoRoot

$platforms = @("darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64")
if ($Platform) {
	$platforms = @($Platform)
}

Write-Host "==> Installing dependencies..."
Run-Command -Exe "npm" -Args @("ci")

if (-not $SkipDeps) {
	Write-Host "==> Installing cross-platform native bindings..."
	Run-Command -Exe "npm" -Args @(
		"install",
		"--no-save",
		"--force",
		"@mariozechner/clipboard-darwin-arm64@0.3.0",
		"@mariozechner/clipboard-darwin-x64@0.3.0",
		"@mariozechner/clipboard-linux-x64-gnu@0.3.0",
		"@mariozechner/clipboard-linux-arm64-gnu@0.3.0",
		"@mariozechner/clipboard-win32-x64-msvc@0.3.0",
		"@img/sharp-darwin-arm64@0.34.5",
		"@img/sharp-darwin-x64@0.34.5",
		"@img/sharp-linux-x64@0.34.5",
		"@img/sharp-linux-arm64@0.34.5",
		"@img/sharp-win32-x64@0.34.5",
		"@img/sharp-libvips-darwin-arm64@1.2.4",
		"@img/sharp-libvips-darwin-x64@1.2.4",
		"@img/sharp-libvips-linux-x64@1.2.4",
		"@img/sharp-libvips-linux-arm64@1.2.4"
	)
} else {
	Write-Host "==> Skipping cross-platform native bindings (--skip-deps)"
}

Write-Host "==> Building all packages..."
Run-Command -Exe "npm" -Args @("run", "build")

Write-Host "==> Building binaries..."
Set-Location "packages/coding-agent"

if (Test-Path "binaries") {
	Remove-Item -Recurse -Force "binaries"
}

foreach ($entry in $platforms) {
	New-Item -ItemType Directory -Path "binaries/$entry" -Force | Out-Null
}

foreach ($entry in $platforms) {
	Write-Host "Building for $entry..."
	if ($entry -eq "windows-x64") {
		Run-Command -Exe "bun" -Args @("build", "--compile", "--target=bun-$entry", "./dist/cli.js", "--outfile", "binaries/$entry/pi.exe")
	} else {
		Run-Command -Exe "bun" -Args @("build", "--compile", "--target=bun-$entry", "./dist/cli.js", "--outfile", "binaries/$entry/pi")
	}
}

Write-Host "==> Creating release archives..."

foreach ($entry in $platforms) {
	Copy-Item "package.json" "binaries/$entry/"
	Copy-Item "README.md" "binaries/$entry/"
	Copy-Item "CHANGELOG.md" "binaries/$entry/"
	Copy-Item "../../node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm" "binaries/$entry/"
	New-Item -ItemType Directory -Path "binaries/$entry/theme" -Force | Out-Null
	Copy-Item "dist/modes/interactive/theme/*.json" "binaries/$entry/theme/"
	Copy-Item "dist/core/export-html" "binaries/$entry/" -Recurse
	Copy-Item "docs" "binaries/$entry/" -Recurse
	Copy-Item "examples" "binaries/$entry/" -Recurse
}

Set-Location "binaries"

foreach ($entry in $platforms) {
	if ($entry -eq "windows-x64") {
		Write-Host "Creating pi-$entry.zip..."
		if (Test-Path "pi-$entry.zip") {
			Remove-Item -Force "pi-$entry.zip"
		}
		Compress-Archive -Path "$entry/*" -DestinationPath "pi-$entry.zip" -Force
	} else {
		Write-Host "Creating pi-$entry.tar.gz..."
		if (Test-Path "pi-$entry.tar.gz") {
			Remove-Item -Force "pi-$entry.tar.gz"
		}
		if (Test-Path "pi") {
			Remove-Item -Recurse -Force "pi"
		}
		Rename-Item $entry "pi"
		Run-Command -Exe "tar" -Args @("-czf", "pi-$entry.tar.gz", "pi")
		Rename-Item "pi" $entry
	}
}

Write-Host "==> Extracting archives for testing..."
foreach ($entry in $platforms) {
	if (Test-Path $entry) {
		Remove-Item -Recurse -Force $entry
	}

	if ($entry -eq "windows-x64") {
		Expand-Archive -Path "pi-$entry.zip" -DestinationPath $entry -Force
	} else {
		Run-Command -Exe "tar" -Args @("-xzf", "pi-$entry.tar.gz")
		Rename-Item "pi" $entry
	}
}

Write-Host ""
Write-Host "==> Build complete!"
Write-Host "Archives available in packages/coding-agent/binaries/"

Get-ChildItem -File | Where-Object { $_.Name -like "*.tar.gz" -or $_.Name -like "*.zip" } | ForEach-Object {
	Write-Host "  $($_.Name)"
}

Write-Host ""
Write-Host "Extracted directories for testing:"
foreach ($entry in $platforms) {
	Write-Host "  binaries/$entry/pi"
}
