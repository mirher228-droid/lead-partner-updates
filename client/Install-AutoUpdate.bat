@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Install-AutoUpdate.ps1" %*
set "LeadPartnerExitCode=%ERRORLEVEL%"
echo.
pause
exit /b %LeadPartnerExitCode%
