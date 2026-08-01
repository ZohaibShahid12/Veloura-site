@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Veloura V8 Fresh Launcher

echo =====================================================
echo   Veloura V8 - Stop Old Server and Start This Folder
echo =====================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 22 or newer and try again.
  pause
  exit /b 1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  echo Stopping previous server on port 3000 - PID %%P...
  taskkill /PID %%P /F >nul 2>nul
)

timeout /t 2 /nobreak >nul

set "NEED_INSTALL=0"
if not exist "node_modules\express\package.json" set "NEED_INSTALL=1"
if not exist "node_modules\ejs\package.json" set "NEED_INSTALL=1"
if not exist "node_modules\better-sqlite3\package.json" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="1" (
  echo Installing project dependencies...
  if exist "node_modules" rmdir /s /q "node_modules"
  call npm install --registry=https://registry.npmjs.org --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting Veloura build V8.0.0 from:
echo %CD%
echo.
echo Version check: http://localhost:3000/version
echo Gallery:       http://localhost:3000/gallery
echo.
start "Veloura V8 Server" cmd /k "cd /d "%CD%" && npm start"
timeout /t 4 /nobreak >nul
start "" http://localhost:3000/gallery

echo V8 server launched in the new terminal window.
echo Keep the server window open while using the website.
pause
