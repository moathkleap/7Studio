@echo off
setlocal enabledelayedexpansion
title 7vid
cd /d "%~dp0"

echo ============================================
echo   7vid - starting
echo ============================================
echo.

REM --- Node.js (>= 22) ---
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not installed.
  echo     Install Node.js 22+ from https://nodejs.org  ^(or: winget install OpenJS.NodeJS.LTS^)
  echo     then run this file again.
  pause
  exit /b 1
)

REM --- pnpm (via corepack) ---
where pnpm >nul 2>nul
if errorlevel 1 call corepack enable >nul 2>nul
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [X] pnpm is not available.
  echo     Open PowerShell as Administrator and run:  corepack enable
  echo     then run this file again.
  pause
  exit /b 1
)

REM --- FFmpeg (warn only) ---
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [!] FFmpeg was not found on PATH. Editing and export need it.
  echo     Install with:  winget install Gyan.FFmpeg   ^(then reopen this window^)
  echo.
)

REM --- install dependencies on first run ---
if not exist "node_modules" (
  echo Installing dependencies ^(first run - may take a few minutes^)...
  call pnpm install
  if errorlevel 1 (
    echo [X] pnpm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo Starting the desktop app...
call pnpm dev
if errorlevel 1 (
  echo.
  echo [!] Desktop mode did not start. Trying browser mode instead...
  echo     When it is ready, open the http://localhost address it prints.
  call pnpm dev:browser
)

pause
