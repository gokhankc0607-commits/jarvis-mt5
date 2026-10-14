@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title JARVIS - EXE Derleyici
cd /d "%~dp0"

echo.
echo  ===============================================
echo    J A R V I S   -   Windows EXE derleyici
echo  ===============================================
echo.

echo [1/6] Python kontrol ediliyor...
call "%~dp0find_python.bat" || (pause & exit /b 1)

REM Eski / yanlis surumle olusturulmus sanal ortami temizle
if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe -c "import sys,struct;sys.exit(0 if sys.version_info[:2] in ((3,10),(3,11),(3,12)) and struct.calcsize('P')==8 else 1)" 2>nul || (
    echo      Eski sanal ortam uyumsuz Python ile olusturulmus, siliniyor...
    rmdir /s /q .venv
  )
)
if exist .venv if not exist .venv\Scripts\python.exe rmdir /s /q .venv
if not exist .venv (
  echo      Sanal ortam olusturuluyor...
  "%JPY%" -m venv .venv || (echo [HATA] venv olusturulamadi & pause & exit /b 1)
)
call .venv\Scripts\activate.bat

echo [2/6] Bagimliliklar kuruluyor (ilk seferde birkac dakika surer)...
python -m pip install --upgrade pip wheel setuptools >nul
pip install -r requirements.txt "pyinstaller>=6.10,<7" || (
  echo.
  echo [HATA] Cekirdek paketler kurulamadi. Internet baglantinizi kontrol edin.
  echo        Sorun devam ederse .venv klasorunu silip tekrar deneyin.
  pause & exit /b 1
)
echo      Ses paketleri kuruluyor (faster-whisper, piper)...
pip install -r requirements-voice.txt || (
  echo [UYARI] Ses paketleri kurulamadi - JARVIS sessiz modda / Windows sesiyle calisacak.
)

echo [3/6] Onceki derleme temizleniyor...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [4/6] PyInstaller ile JARVIS.exe derleniyor...
pyinstaller --noconfirm --clean jarvis.spec || (echo [HATA] PyInstaller basarisiz & pause & exit /b 1)

echo [5/6] Modeller ve yapilandirma kopyalaniyor...
if not exist dist\JARVIS\voices mkdir dist\JARVIS\voices
if not exist dist\JARVIS\models mkdir dist\JARVIS\models
copy /y config.example.json dist\JARVIS\ >nul
copy /y README.md dist\JARVIS\ >nul
if exist jarvis.ico copy /y jarvis.ico dist\JARVIS\ >nul
if exist config.json copy /y config.json dist\JARVIS\ >nul

if /I "%~1"=="--no-models" goto :skipmodels
echo      - Piper Turkce ses (tr_TR-dfki-medium) indiriliyor...
set PV=https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium
if not exist voices\tr_TR-dfki-medium.onnx (
  if not exist voices mkdir voices
  curl -L -s -o voices\tr_TR-dfki-medium.onnx %PV%/tr_TR-dfki-medium.onnx
  curl -L -s -o voices\tr_TR-dfki-medium.onnx.json %PV%/tr_TR-dfki-medium.onnx.json
)
copy /y voices\* dist\JARVIS\voices\ >nul
echo      - faster-whisper "small" modeli indiriliyor (cevrimdisi kullanim icin)...
if not exist models\whisper-small (
  python -c "from faster_whisper import download_model; download_model('small', output_dir='models/whisper-small')"
)
xcopy /e /i /y /q models\whisper-small dist\JARVIS\models\whisper-small >nul
:skipmodels

echo [6/6] Kurulum paketi (Setup.exe) - Inno Setup varsa...
set ISCC="%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist %ISCC% (
  %ISCC% /Q installer.iss && echo      - dist\JARVIS-Setup.exe olusturuldu
) else (
  echo      - Inno Setup bulunamadi, Setup.exe atlandi. ^(https://jrsoftware.org/isdl.php^)
)

echo.
echo  TAMAMLANDI:
echo    Tasinabilir:  dist\JARVIS\JARVIS.exe
if exist dist\JARVIS-Setup.exe echo    Kurulum:      dist\JARVIS-Setup.exe
echo.
echo  Ilk calistirmada kurulum sihirbazi acilir. Yeniden acmak icin: JARVIS.exe --setup
echo.
if not "%JARVIS_AUTO%"=="1" pause
