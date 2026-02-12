@echo off
setlocal
set SCRIPT_DIR=%~dp0

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%bootstrap-zk-guardian.ps1" %*

endlocal
