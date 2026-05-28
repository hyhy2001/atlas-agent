$ErrorActionPreference = "Stop"

$Version = if ($env:ATLAS_VERSION) { $env:ATLAS_VERSION } else { "latest" }
$BaseUrl = if ($env:ATLAS_INSTALL_URL) { $env:ATLAS_INSTALL_URL } else { "https://artifacts.company.local/atlas-agent" }
$InstallDir = "$env:USERPROFILE\.atlas-agent"

Write-Host "=== Installing atlas-agent ===" -ForegroundColor Cyan
Write-Host ""

$Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$Asset = "atlas-agent-v$Version-windows-$Arch.zip"
if ($Version -eq "latest") { $Asset = "atlas-agent-latest-windows-$Arch.zip" }

Write-Host "Platform: windows-$Arch"
Write-Host "Source:   $BaseUrl/$Asset"
Write-Host "Install:  $InstallDir"
Write-Host ""

Write-Host "[1/4] Downloading..." -ForegroundColor Yellow
$TmpFile = [System.IO.Path]::GetTempFileName() + ".zip"
try {
    Invoke-WebRequest -Uri "$BaseUrl/$Asset" -OutFile $TmpFile -UseBasicParsing
} catch {
    Write-Host "Error: Download failed. Check ATLAS_INSTALL_URL or network." -ForegroundColor Red
    exit 1
}

Write-Host "[2/4] Installing to $InstallDir..." -ForegroundColor Yellow
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Expand-Archive -Path $TmpFile -DestinationPath $InstallDir -Force
Remove-Item $TmpFile -Force

Write-Host "[3/4] Running setup..." -ForegroundColor Yellow
$SetupBat = Join-Path $InstallDir "setup.bat"
if (Test-Path $SetupBat) { & cmd /c $SetupBat }

Write-Host "[4/4] Adding to PATH..." -ForegroundColor Yellow
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$UserPath", "User")
    Write-Host "  Added $InstallDir to user PATH"
}

Write-Host ""
Write-Host "=== Installation complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Configure (set environment variables):"
Write-Host "  `$env:ATLAS_AUTH_TOKEN = 'your-token'"
Write-Host "  `$env:ATLAS_BASE_URL = 'http://your-proxy:port/v1'"
Write-Host ""
Write-Host "Then open a new terminal and run: atlas-agent"
