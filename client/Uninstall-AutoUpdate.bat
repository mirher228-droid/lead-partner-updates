@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-AutoUpdate.ps1" %*
set "LeadPartnerExitCode=%ERRORLEVEL%"
echo.
pause
exit /b %LeadPartnerExitCode%
