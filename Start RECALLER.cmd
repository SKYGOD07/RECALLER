@echo off
REM RECALLER - double-click launcher for Windows.
REM Delegates to the PowerShell script, which does the dependency checks,
REM builds the console if needed and opens a browser.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-recaller.ps1" %*
if errorlevel 1 (
  echo.
  echo RECALLER could not start. The message above says why.
  echo.
  pause
)
endlocal
