@echo off
setlocal
title JARVIS Komuta Merkezi
cd /d "%~dp0"

if not exist .next\BUILD_ID (
  echo Panel henuz derlenmemis. Once PANEL_KUR.bat calistiriliyor...
  call "%~dp0PANEL_KUR.bat" %*
  exit /b
)
set "BUILT="
set "WANT="
if exist .next\jarvis_built.txt set /p BUILT=<.next\jarvis_built.txt
if exist VERSION set /p WANT=<VERSION
if not "%BUILT%"=="%WANT%" (
  echo Panel guncellenmis ^(%BUILT% - %WANT%^). Yeniden derleniyor...
  call "%~dp0PANEL_KUR.bat" %*
  exit /b
)
if not exist .env.local (
  >.env.local echo DATABASE_URL=pglite:shared
)

REM ---------- Erisim kapsami ----------
REM Varsayilan: yalnizca bu bilgisayar (127.0.0.1). Ayni agdaki herkes panele girip emir
REM onaylayamasin diye. Telefon/QR icin:  PANEL_BASLAT.bat lan   (veya .env.local: JARVIS_LAN=1)
set "HOST=127.0.0.1"
set "JARVIS_LAN="
if /i "%~1"=="lan" set "JARVIS_LAN=1"
if /i "%~1"=="--lan" set "JARVIS_LAN=1"
for /f "usebackq tokens=1,* delims==" %%a in (".env.local") do (
  if /i "%%a"=="JARVIS_LAN" if "%%b"=="1" set "JARVIS_LAN=1"
)
if "%JARVIS_LAN%"=="1" set "HOST=0.0.0.0"

REM 3000 portu doluysa uyar
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul && (
  echo [UYARI] 3000 portu kullanimda. Panel zaten acik olabilir: http://localhost:3000
  echo         Eski pencereyi kapatin veya devam etmek icin bir tusa basin.
  pause
)

echo.
echo  ============================================================
echo     PANEL HAZIR  -  tarayicida acin:  http://localhost:3000
echo.
echo     Giris:   demo@jarvis.local   /   jarvis123
echo     (veya "Hesap olustur" ile kendi hesabiniz)
echo.
if "%JARVIS_LAN%"=="1" (
  echo     ERISIM: AG MODU - ayni Wi-Fi'deki cihazlar panele ulasabilir.
  echo     TELEFON: panelde  Telefon ^(QR^)  sayfasindan QR okutun.
  echo     [UYARI] demo@jarvis.local sifresini degistirin: sol alt menu - "Sifre degistir"
) else (
  echo     ERISIM: yalnizca bu bilgisayar. Telefon/QR icin:  PANEL_BASLAT.bat lan
)
echo.
echo     GUNCELLEME: Yeni RAR/ZIP indirdiginizde PANEL_GUNCELLE.bat calistirin
echo                 ^(veya RAR/ZIP dosyasini PANEL_GUNCELLE.bat uzerine surukleyin^)
echo.
echo     JARVIS.exe kurulum sihirbazinda Panel URL:
echo        http://localhost:3000
echo.
echo     Durdurmak icin bu pencerede CTRL+C
echo  ============================================================
echo.

start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
call npm run start -- -H %HOST% -p 3000
pause
