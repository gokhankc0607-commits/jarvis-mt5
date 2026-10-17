@echo off
setlocal
title JARVIS Yerel Ajan - Guncelleme
cd /d "%~dp0"

echo.
echo  ============================================================
echo     J A R V I S   Y E R E L   A J A N  -  GUNCELLEME
echo  ============================================================
echo   config.json ve tf_map.json dosyalarina DOKUNULMAZ.
echo  ============================================================
echo.

REM Eger bir RAR/ZIP dosyasi bu bat uzerine suruklendiyse ondan guncelle
if not "%~1"=="" (
  echo [1/2] Arsivden ajan dosyalari cikartiliyor: %~nx1
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$arc='%~f1'; $dst='%~dp0'.TrimEnd('\'); $tmp=Join-Path $env:TEMP ('jarvis_ag_' + [Guid]::NewGuid().ToString('N').Substring(0,6)); New-Item -ItemType Directory -Path $tmp -Force | Out-Null; " ^
    "$tar=Join-Path $env:SystemRoot 'System32\tar.exe'; $rar=\"$env:ProgramFiles\WinRAR\WinRAR.exe\"; $z7=\"$env:ProgramFiles\7-Zip\7z.exe\"; " ^
    "if (Test-Path $rar) { Start-Process $rar -ArgumentList @('x','-ibck','-y',\"`\"$arc`\"\",\"`\"$tmp\`\"\") -Wait -NoNewWindow } " ^
    "elseif (Test-Path $z7) { Start-Process $z7 -ArgumentList @('x','-y',\"`\"$arc`\"\",\"`\"-o$tmp`\"\") -Wait -NoNewWindow } " ^
    "else { Start-Process $tar -ArgumentList @('-xf',\"`\"$arc`\"\",'-C',\"`\"$tmp`\"\") -Wait -NoNewWindow }; " ^
    "$py = Get-ChildItem -LiteralPath $tmp -Filter 'mt5_engine.py' -Recurse -File | Select-Object -First 1; " ^
    "if (-not $py) { Write-Host '[HATA] Arsivde ajan dosyalari bulunamadi.' -ForegroundColor Red; Remove-Item $tmp -Recurse -Force; exit 1 }; " ^
    "Start-Process robocopy.exe -ArgumentList @(\"`\"$($py.Directory.FullName)`\"\",\"`\"$dst`\"\",'/E','/XD','.venv','models','logs','dist','build','__pycache__','/XF','config.json','tf_map.json','.jarvis_state.json','/NFL','/NDL','/NJH','/NJS') -Wait -NoNewWindow; " ^
    "Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '[OK] Ajan dosyalari arsivden guncellendi.' -ForegroundColor Green"
  goto :done
)

REM Panel aciksa panelden en son ajan dosyalarini cek
echo [1/2] Panelden guncel ajan dosyalari indiriliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $u = (Get-Content config.json -Raw | ConvertFrom-Json).dashboard_url.TrimEnd('/'); $m = Invoke-RestMethod \"$u/api/agent/manifest\" -TimeoutSec 8; " ^
  "foreach ($f in $m.files) { $p = Join-Path (Get-Location) ($f -replace '/','\'); New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null; Invoke-WebRequest -UseBasicParsing \"$u/api/agent/file?name=$([uri]::EscapeDataString($f))\" -OutFile $p -TimeoutSec 15 }; " ^
  "Write-Host \"[OK] Ajan panelden v$($m.version) surumune guncellendi.\" -ForegroundColor Green } catch { Write-Host '[UYARI] Panele ulasilamadi: ' $_ -ForegroundColor Yellow }"

:done
echo.
echo [2/2] Ajan baslatiliyor...
call "%~dp0CALISTIR.bat"
