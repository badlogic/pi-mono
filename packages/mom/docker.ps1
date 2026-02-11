param(
	[Parameter(Position = 0)]
	[string]$Command = "",
	[Parameter(Position = 1)]
	[string]$DataDir = ""
)

$ErrorActionPreference = "Stop"

$containerName = "mom-sandbox"
$image = "alpine:latest"

function Show-Usage {
	Write-Host "Mom Docker Sandbox Management"
	Write-Host ""
	Write-Host "Usage: ./docker.ps1 <command> [args]"
	Write-Host ""
	Write-Host "Commands:"
	Write-Host "  create <data-dir>  - Create and start the container"
	Write-Host "  start              - Start the container"
	Write-Host "  stop               - Stop the container"
	Write-Host "  remove             - Remove the container"
	Write-Host "  status             - Check container status"
	Write-Host "  shell              - Open a shell in the container"
}

switch ($Command) {
	"create" {
		if ([string]::IsNullOrWhiteSpace($DataDir)) {
			Write-Host "Usage: ./docker.ps1 create <data-dir>"
			Write-Host "Example: ./docker.ps1 create ./data"
			exit 1
		}

		if (-not (Test-Path -LiteralPath $DataDir)) {
			Write-Host "Data dir does not exist: $DataDir"
			exit 1
		}

		$resolvedDataDir = (Resolve-Path -LiteralPath $DataDir).Path
		$existing = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $containerName }
		if ($existing) {
			Write-Host "Container '$containerName' already exists. Remove it first with: ./docker.ps1 remove"
			exit 1
		}

		Write-Host "Creating container '$containerName'..."
		Write-Host "  Data dir: $resolvedDataDir -> /workspace"
		docker run -d --name $containerName -v "${resolvedDataDir}:/workspace" $image tail -f /dev/null | Out-Null
		if ($LASTEXITCODE -ne 0) {
			Write-Host "Failed to create container."
			exit 1
		}

		Write-Host "Container created and running."
		Write-Host ""
		Write-Host "Run mom with: mom --sandbox=docker:$containerName $DataDir"
	}
	"start" {
		Write-Host "Starting container '$containerName'..."
		docker start $containerName | Out-Null
		exit $LASTEXITCODE
	}
	"stop" {
		Write-Host "Stopping container '$containerName'..."
		docker stop $containerName | Out-Null
		exit $LASTEXITCODE
	}
	"remove" {
		Write-Host "Removing container '$containerName'..."
		docker rm -f $containerName | Out-Null
		exit $LASTEXITCODE
	}
	"status" {
		$running = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $containerName }
		if ($running) {
			Write-Host "Container '$containerName' is running."
			docker ps --filter "name=$containerName" --format "table {{.ID}}`t{{.Image}}`t{{.Status}}"
			exit 0
		}

		$existing = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $containerName }
		if ($existing) {
			Write-Host "Container '$containerName' exists but is not running."
			Write-Host "Start it with: ./docker.ps1 start"
			exit 0
		}

		Write-Host "Container '$containerName' does not exist."
		Write-Host "Create it with: ./docker.ps1 create <data-dir>"
		exit 0
	}
	"shell" {
		Write-Host "Opening shell in '$containerName'..."
		docker exec -it $containerName /bin/sh
		exit $LASTEXITCODE
	}
	default {
		Show-Usage
	}
}
