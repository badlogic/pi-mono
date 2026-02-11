$ErrorActionPreference = "Stop"

$containerName = "mom-sandbox"
$dataDir = Join-Path (Get-Location) "data"

if (-not (Test-Path -LiteralPath $dataDir)) {
	New-Item -ItemType Directory -Path $dataDir | Out-Null
}

$exists = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $containerName }
if ($exists) {
	$running = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $containerName }
	if (-not $running) {
		Write-Host "Starting existing container: $containerName"
		docker start $containerName | Out-Null
		if ($LASTEXITCODE -ne 0) {
			exit $LASTEXITCODE
		}
	} else {
		Write-Host "Container $containerName already running"
	}
} else {
	Write-Host "Creating container: $containerName"
	$resolvedDataDir = (Resolve-Path -LiteralPath $dataDir).Path
	docker run -d --name $containerName -v "${resolvedDataDir}:/workspace" alpine:latest tail -f /dev/null | Out-Null
	if ($LASTEXITCODE -ne 0) {
		exit $LASTEXITCODE
	}
}

Write-Host "Starting mom in dev mode..."
npx tsx --watch-path src --watch src/main.ts --sandbox="docker:$containerName" ./data
exit $LASTEXITCODE
