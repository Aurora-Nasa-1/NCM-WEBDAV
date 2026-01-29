@echo off
setlocal

:: Check if node is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

:: Auto update
if exist .git (
    echo Checking for updates...
    :: Avoid conflict with package-lock.json
    git checkout package-lock.json >nul 2>nul
    git pull
)

:: Install dependencies if node_modules doesn't exist
if not exist node_modules (
    echo node_modules not found, installing dependencies...
    call npm install
)

:: Start the WebDAV server
echo Starting WebDAV server...
node webdav.js
pause
