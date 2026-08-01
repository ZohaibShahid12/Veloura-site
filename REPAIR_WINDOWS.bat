@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Veloura V8 Full Repair

echo ==============================================
echo   Veloura V8 - Full Dependency and Cache Repair
echo ==============================================
echo.

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  echo Stopping previous server on port 3000 - PID %%P...
  taskkill /PID %%P /F >nul 2>nul
)

timeout /t 2 /nobreak >nul

if exist "node_modules" rmdir /s /q "node_modules"
if exist "package-lock.json" del /f /q "package-lock.json"
call npm cache verify
call npm install --registry=https://registry.npmjs.org --no-audit --no-fund
if errorlevel 1 (
  echo ERROR: npm installation failed.
  pause
  exit /b 1
)

echo Repair complete. Launching V8...
call START_V8_FRESH.bat
