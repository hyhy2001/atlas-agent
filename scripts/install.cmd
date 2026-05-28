@echo off
setlocal
set "URL=%ATLAS_INSTALL_URL%"
if "%URL%"=="" set "URL=https://artifacts.company.local/atlas-agent"
echo === Installing atlas-agent ===
echo.
powershell -ExecutionPolicy Bypass -Command "& { irm '%URL%/install.ps1' | iex }"
endlocal
