@echo off
cd /d "%~dp0"

where node >nul 2>&1 || (echo Node.js required. & pause & exit /b 1)
where pnpm >nul 2>&1 || (echo pnpm required. Install with: npm i -g pnpm & pause & exit /b 1)
where rustc >nul 2>&1 || (echo Rust required. Install from https://rustup.rs & pause & exit /b 1)
where cargo >nul 2>&1 || (echo Cargo required. Install from https://rustup.rs & pause & exit /b 1)

if not exist node_modules (
  echo Installing JavaScript dependencies...
  call pnpm install || (pause & exit /b 1)
)

REM Free sticky Vite port 5181 if this project's leftover node still holds it.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5181" ^| findstr "LISTENING"') do (
  set "PORT_PID=%%a"
)
if defined PORT_PID (
  echo Freeing sticky port 5181 ^(PID %PORT_PID%^)...
  taskkill /PID %PORT_PID% /F >nul 2>&1
)

echo Starting Deez Currency Calculator (Tauri)...
call pnpm tauri:dev
if errorlevel 1 (
  echo App failed to start.
  pause
  exit /b 1
)
pause
