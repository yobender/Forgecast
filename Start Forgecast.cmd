@echo off
cd /d "%~dp0"
start "Forgecast Engine Manager" /min node "%~dp0scripts\engine-manager.mjs"
start "Forgecast Server" /min cmd /c "npm run dev -- --host 127.0.0.1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5173"
