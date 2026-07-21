# free-ports.ps1 - giai phong cac port dev truoc khi start.bat khoi dong lai.
#
# Vi sao can: start.bat mo 3 tool con bang `cmd /k` trong cua so rieng. Dong cua so
# launcher KHONG giet chung, nen lan chay sau vite bao "Port 5173 is already in use"
# (vite.config.ts dat strictPort: true nen no chet han thay vi nhay port khac).
#
# Chi giet tien trinh `node`. Neu port bi mot chuong trinh khac giu, script dung lai
# va bao loi - khong tu y giet thu gi cua nguoi dung.

param([Parameter(ValueFromRemainingArguments = $true)][int[]]$Ports)

$ErrorActionPreference = 'Stop'
if (-not $Ports) { $Ports = 5173, 5174, 5175, 5176, 5177 }

$failed = $false

foreach ($port in $Ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { continue }

    # `$pid` la bien tu dong read-only cua PowerShell - dung ten khac.
    foreach ($procId in ($conns.OwningProcess | Sort-Object -Unique)) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if (-not $proc) { continue }

        if ($proc.ProcessName -eq 'node') {
            Write-Host ("[Launcher] Port {0}: dong tien trinh node cu (PID {1})." -f $port, $procId)
            try {
                Stop-Process -Id $procId -Force -ErrorAction Stop
            } catch {
                Write-Host ("[Launcher] Khong dong duoc PID {0}: {1}" -f $procId, $_.Exception.Message) -ForegroundColor Red
                $failed = $true
            }
        } else {
            $msg = "[Launcher] Port {0} dang bi '{1}' (PID {2}) giu - KHONG phai node." -f $port, $proc.ProcessName, $procId
            Write-Host $msg -ForegroundColor Red
            [Console]::Error.WriteLine($msg)   # stderr: de Hub doc duoc ly do that va hien cho user
            Write-Host "[Launcher] Hay tu dong chuong trinh do roi chay lai." -ForegroundColor Red
            $failed = $true
        }
    }
}

# Doi cho Windows tra port ve trang thai free (TIME_WAIT ngan, thuong < 1s).
if (-not $failed) {
    foreach ($i in 1..10) {
        $still = @($Ports | Where-Object {
            Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue
        })
        if ($still.Count -eq 0) { break }
        Start-Sleep -Milliseconds 200
    }
}

if ($failed) { exit 1 }
exit 0
