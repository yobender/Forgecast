@echo off
cd /d "%~dp0"
if exist "%~dp0.runtime\modly\api\.venv\Scripts\python.exe" (
  start "Forgecast AI Engine" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-real-engine.ps1"
)
start "Forgecast Server" /min cmd /c "npm run dev -- --host 127.0.0.1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5173"
