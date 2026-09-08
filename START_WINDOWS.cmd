@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 22 of nieuwer is nodig. Installeer Node.js en probeer opnieuw.
 pause
 exit /b 1
)
echo Open na het starten: http://127.0.0.1:4173
node src/server.mjs
pause
