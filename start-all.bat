@echo off
setlocal
cd /d "%~dp0"

echo ==========================================================
echo    SILLYTAVERN MULTI TOOLS  -  Launcher (CHAY HET 5 TOOL)
echo ==========================================================
echo.
echo Ban dang dung che do CU: mo san ca 5 dev server cung luc (ton RAM hon).
echo Binh thuong chi can start.bat - tool nao bam toi se tu khoi dong.
echo.

REM -- Don het port truoc khi chay (chi giet node; gap process la thi dung lai) --
echo [Launcher] Don port 5173-5177...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\free-ports.ps1" 5173 5174 5175 5176 5177
if errorlevel 1 (
    echo.
    echo [Launcher] Khong giai phong duoc port. Xem thong bao ben tren roi chay lai.
    pause >nul
    exit /b 1
)
echo.

REM -- Dong bo thu vien Hub roi chay ca 5 server trong 1 cua so (scripts/start-all.js) --
echo [Hub] Dong bo thu vien (npm install)...
call npm install --no-audit --no-fund
echo [Launcher] Khoi dong ca 5 tool (1 cua so duy nhat)...
echo.
call npm run dev:all

echo.
echo (Da dung.) Nhan phim bat ky de dong.
pause >nul
