<# :
@echo off
setlocal
title JARVIS Panel - RAR / ZIP / GitHub Otomatik Guncelleme
cd /d "%~dp0"
set "JARVIS_ROOT=%~dp0"
set "JARVIS_ARG=%~1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = Get-Content -LiteralPath '%~f0' -Raw; Invoke-Expression $s"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [HATA] Guncelleme tamamlanamadi ^(Kod: %EXIT_CODE%^).
  pause
  exit /b %EXIT_CODE%
)
exit /b 0
#>

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = ($env:JARVIS_ROOT).TrimEnd('\', '/')
$ArgPath = $env:JARVIS_ARG
Set-Location -LiteralPath $Root

$curVer = if (Test-Path "$Root\VERSION") { (Get-Content "$Root\VERSION" -Raw).Trim() } else { "bilinmiyor" }

Write-Host ""
Write-Host " ============================================================" -ForegroundColor Cyan
Write-Host "    J A R V I S   O T O M A T I K   G U N C E L L E Y I C I" -ForegroundColor Cyan
Write-Host " ============================================================" -ForegroundColor Cyan
Write-Host "  Mevcut klasor : $Root"
Write-Host "  Mevcut surum  : v$curVer"
Write-Host "  Verileriniz (%APPDATA%\JARVIS\jarvis.db.tgz, .env.local ve"
Write-Host "  config.json) korunur; yeni dosyalar direkt bu klasore cekilir."
Write-Host " ============================================================" -ForegroundColor Cyan
Write-Host ""

function Find-NewestArchive {
  $dirs = @(
    $Root,
    (Split-Path -Parent $Root),
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Desktop")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

  $candidates = @()
  foreach ($d in $dirs) {
    try {
      $files = Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue |
        Where-Object {
          $_.Extension -match '^\.(rar|zip|7z)$' -and
          $_.Name -notmatch '^JARVIS-Agent(-GUNCELLEME)?\.zip$'
        }
      foreach ($f in $files) {
        $score = if ($f.Name -match '(?i)(jarvis|mt5|local-ai)') { 1 } else { 0 }
        $candidates += [PSCustomObject]@{
          File  = $f
          Score = $score
          Time  = $f.LastWriteTime
        }
      }
    } catch {}
  }
  if (-not $candidates.Count) { return $null }
  return ($candidates | Sort-Object -Property @{Expression="Score";Descending=$true}, @{Expression="Time";Descending=$true} | Select-Object -First 1).File
}

function Select-ArchiveDialog {
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = "JARVIS Guncel RAR veya ZIP Dosyasini Secin"
  $dlg.Filter = "Arsiv Dosyalari (*.rar;*.zip;*.7z)|*.rar;*.zip;*.7z|Tum Dosyalar (*.*)|*.*"
  $dlPath = Join-Path $env:USERPROFILE "Downloads"
  if (Test-Path $dlPath) { $dlg.InitialDirectory = $dlPath }
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    return $dlg.FileName
  }
  return $null
}

function Extract-ArchiveFile([string]$ArchivePath, [string]$DestDir) {
  New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
  $ext = [System.IO.Path]::GetExtension($ArchivePath).ToLowerInvariant()

  # 1) WinRAR / UnRAR
  $rarTools = @(
    "$env:ProgramFiles\WinRAR\WinRAR.exe",
    "${env:ProgramFiles(x86)}\WinRAR\WinRAR.exe",
    "$env:LocalAppData\Programs\WinRAR\WinRAR.exe",
    "$env:ProgramFiles\WinRAR\UnRAR.exe",
    "${env:ProgramFiles(x86)}\WinRAR\UnRAR.exe"
  )
  foreach ($cmdName in @("WinRAR.exe", "UnRAR.exe")) {
    $c = Get-Command $cmdName -ErrorAction SilentlyContinue
    if ($c) { $rarTools += $c.Source }
  }
  foreach ($tool in ($rarTools | Select-Object -Unique)) {
    if ($tool -and (Test-Path -LiteralPath $tool)) {
      Write-Host "[1/4] Arsiv cikartiliyor ($(Split-Path $tool -Leaf)): $(Split-Path $ArchivePath -Leaf)" -ForegroundColor Yellow
      if ($tool -match '(?i)WinRAR\.exe$') {
        $p = Start-Process -FilePath $tool -ArgumentList @("x", "-ibck", "-y", "`"$ArchivePath`"", "`"$DestDir\`"") -Wait -PassThru -NoNewWindow
      } else {
        $p = Start-Process -FilePath $tool -ArgumentList @("x", "-y", "`"$ArchivePath`"", "`"$DestDir\`"") -Wait -PassThru -NoNewWindow
      }
      if ($p.ExitCode -eq 0 -and (Get-ChildItem -LiteralPath $DestDir -Force | Measure-Object).Count -gt 0) {
        return
      }
    }
  }

  # 2) 7-Zip
  $sevenZipTools = @(
    "$env:ProgramFiles\7-Zip\7z.exe",
    "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
  )
  $c7 = Get-Command "7z.exe" -ErrorAction SilentlyContinue
  if ($c7) { $sevenZipTools += $c7.Source }
  foreach ($tool in ($sevenZipTools | Select-Object -Unique)) {
    if ($tool -and (Test-Path -LiteralPath $tool)) {
      Write-Host "[1/4] Arsiv cikartiliyor (7-Zip): $(Split-Path $ArchivePath -Leaf)" -ForegroundColor Yellow
      $p = Start-Process -FilePath $tool -ArgumentList @("x", "-y", "`"$ArchivePath`"", "`"-o$DestDir`"") -Wait -PassThru -NoNewWindow
      if ($p.ExitCode -eq 0 -and (Get-ChildItem -LiteralPath $DestDir -Force | Measure-Object).Count -gt 0) {
        return
      }
    }
  }

  # 3) Windows yerlesik tar.exe (Windows 10/11 bsdtar hem .rar hem .zip destekler)
  $tarExe = Join-Path $env:SystemRoot "System32\tar.exe"
  if (Test-Path -LiteralPath $tarExe) {
    Write-Host "[1/4] Arsiv cikartiliyor (Windows tar): $(Split-Path $ArchivePath -Leaf)" -ForegroundColor Yellow
    $p = Start-Process -FilePath $tarExe -ArgumentList @("-xf", "`"$ArchivePath`"", "-C", "`"$DestDir`"") -Wait -PassThru -NoNewWindow
    if ($p.ExitCode -eq 0 -and (Get-ChildItem -LiteralPath $DestDir -Force | Measure-Object).Count -gt 0) {
      return
    }
  }

  # 4) .zip icin Expand-Archive
  if ($ext -eq ".zip") {
    Write-Host "[1/4] ZIP cikartiliyor (PowerShell): $(Split-Path $ArchivePath -Leaf)" -ForegroundColor Yellow
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $DestDir -Force
    if ((Get-ChildItem -LiteralPath $DestDir -Force | Measure-Object).Count -gt 0) {
      return
    }
  }

  # 5) .rar acilamadiysa winget ile 7-Zip kurup tekrar dene
  if (Get-Command "winget.exe" -ErrorAction SilentlyContinue) {
    Write-Host "[BILGI] RAR acmak icin 7-Zip kuruluyor (winget)..." -ForegroundColor Yellow
    Start-Process -FilePath "winget.exe" -ArgumentList @("install", "-e", "--id", "7zip.7zip", "--accept-package-agreements", "--accept-source-agreements", "--silent") -Wait -NoNewWindow
    foreach ($tool in @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe")) {
      if (Test-Path -LiteralPath $tool) {
        $p = Start-Process -FilePath $tool -ArgumentList @("x", "-y", "`"$ArchivePath`"", "`"-o$DestDir`"") -Wait -PassThru -NoNewWindow
        if ($p.ExitCode -eq 0 -and (Get-ChildItem -LiteralPath $DestDir -Force | Measure-Object).Count -gt 0) {
          return
        }
      }
    }
  }

  throw "Arsiv cikartilamadi: $ArchivePath. Lutfen WinRAR veya 7-Zip kurulu oldugundan emin olun."
}

$SourcePath = $null
$UseGitHub = $false

if ($ArgPath -and (Test-Path -LiteralPath $ArgPath)) {
  $SourcePath = (Resolve-Path -LiteralPath $ArgPath).Path
  Write-Host "Secilen kaynak: $SourcePath" -ForegroundColor Green
} else {
  $autoFile = Find-NewestArchive
  if ($autoFile) {
    Write-Host "  [1] Otomatik bulunan arsivden guncelle (Varsayilan - Enter):" -ForegroundColor Green
    Write-Host "      $($autoFile.FullName)" -ForegroundColor White
    Write-Host "      (Tarih: $($autoFile.LastWriteTime.ToString('dd.MM.yyyy HH:mm')))" -ForegroundColor DarkGray
  } else {
    Write-Host "  [1] Bilgisayardan RAR / ZIP dosyasi sec (Varsayilan - Enter)" -ForegroundColor Green
  }
  Write-Host "  [2] Dosya secici penceresinden baska RAR / ZIP sec" -ForegroundColor Cyan
  Write-Host "  [3] GitHub deposundan son surumu indirip guncelle" -ForegroundColor Cyan
  Write-Host ""
  $choice = Read-Host "Seciminiz [Varsayilan: 1]"
  if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }

  if ($choice -eq "3") {
    $UseGitHub = $true
  } elseif ($choice -eq "2" -or (-not $autoFile)) {
    $SourcePath = Select-ArchiveDialog
    if (-not $SourcePath) {
      Write-Host "Dosya secilmedi, iptal edildi." -ForegroundColor Yellow
      exit 0
    }
  } else {
    $SourcePath = $autoFile.FullName
  }
}

$StageDir = Join-Path $env:TEMP ("jarvis_update_" + [Guid]::NewGuid().ToString("N").Substring(0, 8))

try {
  if ($UseGitHub) {
    if ((Test-Path "$Root\.git") -and (Get-Command "git.exe" -ErrorAction SilentlyContinue)) {
      Write-Host "[1/4] GitHub'dan git pull ile cekiliyor..." -ForegroundColor Yellow
      & git pull
      if ($LASTEXITCODE -ne 0) { throw "git pull basarisiz oldu." }
      $ExtractedRoot = $null
    } else {
      $zipUrl = "https://github.com/gokhankc0607-commits/jarvis-mt5/archive/refs/heads/main.zip"
      $tmpZip = Join-Path $env:TEMP "jarvis-mt5-main.zip"
      Write-Host "[1/4] GitHub'dan son surum indiriliyor..." -ForegroundColor Yellow
      Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing
      Extract-ArchiveFile -ArchivePath $tmpZip -DestDir $StageDir
      Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue
      $ExtractedRoot = $StageDir
    }
  } elseif ((Get-Item -LiteralPath $SourcePath).PSIsContainer) {
    $ExtractedRoot = $SourcePath
  } else {
    Extract-ArchiveFile -ArchivePath $SourcePath -DestDir $StageDir
    $ExtractedRoot = $StageDir
  }

  if ($ExtractedRoot) {
    # Arsivin icinde ust klasor varsa (orn. local-ai-mt5-jarvis (2)\package.json) otomatik bul
    $pkgFile = Get-ChildItem -LiteralPath $ExtractedRoot -Filter "package.json" -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
      Select-Object -First 1

    if ($pkgFile) {
      $ProjectSrc = $pkgFile.Directory.FullName
      $newVer = if (Test-Path "$ProjectSrc\VERSION") { (Get-Content "$ProjectSrc\VERSION" -Raw).Trim() } else { "yeni" }
      Write-Host "[2/4] Dosyalar klasore aktariliyor ($curVer -> $newVer)..." -ForegroundColor Yellow

      # robocopy ile kullanici verilerine (.env.local, data, node_modules, .git, config.json) dokunmadan kopyala
      $roboArgs = @(
        "`"$ProjectSrc`"",
        "`"$Root`"",
        "/E",
        "/XD", ".git", "node_modules", ".next", "data", ".venv", "models", "dist", "build", "__pycache__",
        "/XF", ".env", ".env.local", "config.json", "tf_map.json", ".jarvis_state.json",
        "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:1"
      )
      $p = Start-Process -FilePath "robocopy.exe" -ArgumentList $roboArgs -Wait -PassThru -NoNewWindow
      if ($p.ExitCode -ge 8) {
        throw "Dosya kopyalama sirasinda hata olustu (robocopy kod: $($p.ExitCode))."
      }

      # Ayrica C:\JARVIS-Agent kuruluysa ajan dosyalarini da (config.json haric) guncelle
      $agentSrc = Join-Path $ProjectSrc "public\agent"
      foreach ($agentDst in @("C:\JARVIS-Agent", (Join-Path $env:USERPROFILE "Desktop\JARVIS-Agent"))) {
        if ((Test-Path -LiteralPath $agentSrc) -and (Test-Path -LiteralPath $agentDst)) {
          Write-Host "      Yerel ajan klasoru de guncelleniyor: $agentDst" -ForegroundColor Cyan
          Start-Process -FilePath "robocopy.exe" -ArgumentList @(
            "`"$agentSrc`"", "`"$agentDst`"", "/E",
            "/XD", ".venv", "models", "logs", "dist", "build", "__pycache__",
            "/XF", "config.json", "tf_map.json", ".jarvis_state.json",
            "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:1"
          ) -Wait -NoNewWindow | Out-Null
        }
      }
    } else {
      # Sadece ajan arsivi mi kontrol et (app.py + mt5_engine.py)
      $agentPy = Get-ChildItem -LiteralPath $ExtractedRoot -Filter "mt5_engine.py" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($agentPy) {
        $AgentSrcDir = $agentPy.Directory.FullName
        $AgentTarget = Join-Path $Root "public\agent"
        Write-Host "[2/4] Ajan dosyalari public\agent klasorune aktariliyor..." -ForegroundColor Yellow
        Start-Process -FilePath "robocopy.exe" -ArgumentList @(
          "`"$AgentSrcDir`"", "`"$AgentTarget`"", "/E",
          "/XD", ".venv", "models", "logs", "dist", "build", "__pycache__",
          "/XF", "config.json", "tf_map.json", ".jarvis_state.json",
          "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:1"
        ) -Wait -NoNewWindow | Out-Null
      } else {
        throw "Secilen arsivde JARVIS proje dosyalari (package.json veya mt5_engine.py) bulunamadi."
      }
    }
  }

  # 3000 portunda acik panel varsa derleme oncesi uyar / kapat
  $port3000 = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
  if ($port3000) {
    Write-Host "[BILGI] 3000 portunda calisan eski panel durduruluyor (yeniden derleme icin)..." -ForegroundColor Yellow
    foreach ($conn in $port3000) {
      try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
    Start-Sleep -Seconds 1
  }

  Write-Host "[3/4] Paketler kontrol ediliyor ve panel yeniden derleniyor..." -ForegroundColor Yellow
  & cmd.exe /c "npm install --no-audit --no-fund"
  if ($LASTEXITCODE -ne 0) { throw "npm install basarisiz oldu." }

  if (Test-Path "$Root\.next") {
    Remove-Item -LiteralPath "$Root\.next" -Recurse -Force -ErrorAction SilentlyContinue
  }
  & cmd.exe /c "npm run build"
  if ($LASTEXITCODE -ne 0) { throw "npm run build basarisiz oldu." }

  if (Test-Path "$Root\VERSION") {
    Copy-Item -LiteralPath "$Root\VERSION" -Destination "$Root\.next\jarvis_built.txt" -Force
  }

  $finalVer = if (Test-Path "$Root\VERSION") { (Get-Content "$Root\VERSION" -Raw).Trim() } else { "guncel" }
  Write-Host ""
  Write-Host " ============================================================" -ForegroundColor Green
  Write-Host "  [4/4] GUNCELLEME TAMAMLANDI! Yeni surum: v$finalVer" -ForegroundColor Green
  Write-Host "        Verileriniz ve ayarlariniz korundu." -ForegroundColor Green
  Write-Host " ============================================================" -ForegroundColor Green
  Write-Host ""
} finally {
  if (Test-Path -LiteralPath $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$runNow = Read-Host "Panel simdi baslatilsin mi? [E/h (Enter = Evet)]"
if ([string]::IsNullOrWhiteSpace($runNow) -or $runNow -match '^(?i)(e|evet|y|yes)$') {
  & cmd.exe /c "`"$Root\PANEL_BASLAT.bat`""
}
