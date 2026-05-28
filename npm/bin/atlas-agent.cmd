@echo off
if exist "%~dp0atlas-agent.exe" (
  "%~dp0atlas-agent.exe" %*
) else (
  echo atlas-agent binary not found. Run: node scripts\postinstall.mjs
  exit /b 1
)
