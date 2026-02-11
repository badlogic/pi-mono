param(
	[switch]$DryRun
)

$ErrorActionPreference = "Stop"

$agentDir = if ($env:PI_AGENT_DIR) { $env:PI_AGENT_DIR } else { Join-Path $HOME ".pi\agent" }

if ($DryRun) {
	Write-Host "Dry run mode - no files will be moved"
	Write-Host ""
}

$files = @()
if (Test-Path -LiteralPath $agentDir) {
	$files = Get-ChildItem -Path $agentDir -Filter "*.jsonl" -File -ErrorAction SilentlyContinue
}

if ($files.Count -eq 0) {
	Write-Host "No session files found in $agentDir"
	exit 0
}

Write-Host "Found $($files.Count) session file(s) to migrate"
Write-Host ""

$migrated = 0
$failed = 0

foreach ($file in $files) {
	$filename = $file.Name

	try {
		$firstLine = Get-Content -Path $file.FullName -TotalCount 1 -ErrorAction Stop
	} catch {
		Write-Host "SKIP: $filename - cannot read file"
		$failed++
		continue
	}

	try {
		$parsed = $firstLine | ConvertFrom-Json -ErrorAction Stop
	} catch {
		Write-Host "SKIP: $filename - invalid JSON"
		$failed++
		continue
	}

	$cwd = [string]$parsed.cwd
	if ([string]::IsNullOrWhiteSpace($cwd)) {
		Write-Host "SKIP: $filename - no cwd in session header"
		$failed++
		continue
	}

	$encoded = $cwd -replace '^[\\/]+', ""
	$encoded = $encoded -replace '[/:\\]', "-"
	$encoded = "--$encoded--"

	$targetDir = Join-Path (Join-Path $agentDir "sessions") $encoded
	$targetFile = Join-Path $targetDir $filename

	if (Test-Path -LiteralPath $targetFile) {
		Write-Host "SKIP: $filename - target already exists"
		$failed++
		continue
	}

	Write-Host "MIGRATE: $filename"
	Write-Host "    cwd: $cwd"
	Write-Host "    to:  $targetDir\"

	if (-not $DryRun) {
		New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
		Move-Item -Path $file.FullName -Destination $targetFile
	}

	$migrated++
	Write-Host ""
}

Write-Host "---"
Write-Host "Migrated: $migrated"
Write-Host "Skipped:  $failed"

if ($DryRun -and $migrated -gt 0) {
	Write-Host ""
	Write-Host "Run without --dry-run to perform the migration"
}
