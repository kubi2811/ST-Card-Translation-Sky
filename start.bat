@echo off
setlocal
cd /d "%~dp0"

echo ==========================================================
echo    SILLYTAVERN MULTI TOOLS  -  Launcher
echo ==========================================================
echo.

REM -- Chi don port 5173 cua Hub. KHONG dong cac tool con (5174-5177): neu chung con song
REM tu lan truoc, Hub se tu NHAN LAI (orphan adopt) va dung tiep - khong can khoi dong lai.
echo [Launcher] Don port 5173...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\free-ports.ps1" 5173
if errorlevel 1 (
    echo.
    echo [Launcher] Khong giai phong duoc port. Xem thong bao ben tren roi chay lai.
    pause >nul
    exit /b 1
)
echo.

REM -- CHI khoi dong Hub (Dich Card, port 5173). Cac tool khac (Tao Card / Tao Preset /
REM Mod Card / Crawler) KHONG chay san nua cho nhe may: bam tab tuong ung trong giao dien
REM la tool tu khoi dong (an trong nen, khong bung cua so CMD). Muon chay het nhu truoc:
REM dung start-all.bat.
echo.
REM LUON dong bo thu vien: sau khi cap nhat (git pull/reset) co the co dependency MOI.
echo [Hub] Dong bo thu vien (npm install)...
call npm install --no-audit --no-fund
echo [Hub] Khoi dong tren http://localhost:5173 ...
echo.
call npm run dev

REM -- Hub da dung: quet not cac tool con (ke ca server Hub da spawn ngam) de khong ket port --
echo.
echo [Launcher] Dong cac tool con...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\free-ports.ps1" 5174 5175 5176 5177

echo.
echo (Da dung.) Nhan phim bat ky de dong.
pause >nul
