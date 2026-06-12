@echo off
cd /d "%~dp0"
echo =======================================
echo   Updating Application...
echo =======================================
echo.

echo Pulling latest changes from GitHub...
call git pull
if %ERRORLEVEL% neq 0 (
    echo.
    echo =======================================
    echo   [ERROR] Failed to pull changes from GitHub!
    echo   Please resolve any local conflicts or changes and try again.
    echo   Common solution: run "git stash" to temporarily save your changes.
    echo =======================================
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Installing new dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo =======================================
    echo   [ERROR] Failed to install dependencies!
    echo =======================================
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo =======================================
echo   Update complete!
echo   You can now run start.bat to launch the app.
echo =======================================
pause

