# JARVIS Yerel Ajan

| Modül | Görev |
|---|---|
| `mt5_engine.py` | MT5 bağlantısı, fiyat/mum, RSI·CCI·Stoch·ATR, uyumsuzluk, onaylı emir |
| `mql5_compiler.py` | .mq5 oku/yaz, `metaeditor64.exe /compile`, log parse, otonom LLM düzeltme |
| `local_ai.py` | Ollama / LM Studio / OmniRoute (+ opsiyonel bulut), faster-whisper STT, Piper TTS |
| `app.py` | Ana çalıştırıcı: panel senkronu, sesli onay, derleme işçisi, "Jarvis" uyandırma |
| `jarvis_launcher.py` | EXE giriş noktası + kurulum sihirbazı (otomatik MT5 yolu bulma, bağlantı testi) |

## Python sürümü
MetaTrader5 kütüphanesi **64-bit Python** için yayınlanır; bu proje **3.10–3.12** ile test edilmiştir. Derleme betikleri
otomatik olarak **64-bit Python 3.11**'i bulur/kurar (`find_python.bat`); bilgisayardaki diğer
Python sürümlerine dokunmaz. Hata alırsanız `.venv` klasörünü silip tekrar deneyin.

## EN KOLAY YOL
1. Zip'i bir klasöre çıkartın (örn. `C:\JARVIS-Agent`).
2. **`KUR.bat`** dosyasına çift tıklayın — her şeyi otomatik yapar ve `JARVIS-Setup.exe`'yi açar.
3. Kurulumdan sonra masaüstündeki **JARVIS** simgesiyle başlatın.

## EXE oluşturma (Windows — elle)

**Yöntem A — kendi bilgisayarınızda (önerilen):**
1. Python 3.11 kurun ("Add to PATH" işaretli).
2. (Opsiyonel) Setup.exe için Inno Setup 6: https://jrsoftware.org/isdl.php
3. Bu klasörde `build_exe.bat` dosyasına çift tıklayın.
   - Çıktı: `dist\JARVIS\JARVIS.exe` (taşınabilir) ve `dist\JARVIS-Setup.exe` (kurulum)
   - Modelleri indirmeden: `build_exe.bat --no-models`

**Yöntem B — GitHub Actions (bilgisayara bir şey kurmadan):**
1. Bu klasörü **private** bir GitHub reposuna push edin (config.json anahtarınızı içerir).
2. Actions → "Build JARVIS EXE" → Run workflow.
3. "JARVIS-Windows" artefaktını indirin.

## Çalıştırma
- `JARVIS.exe` — ilk açılışta kurulum sihirbazı (config.json eksik/geçersizse)
- `JARVIS.exe --setup` — sihirbazı yeniden aç
- `JARVIS.exe --no-voice` — sessiz mod · `--simulate` — MT5'siz test
- Loglar: `logs\`

**Kesin kural:** `place_order(..., approved=True)` yalnızca paneldeki `approved` sinyaller için çağrılır.
Sinyal yalnızca açık bir "Evet" (sesli veya panelde) ile `approved` olur.

## Panel güncellemesi (v2.6)
Panelde grafik / RSI-CCI radarı için ajan artık mum verisi gönderir. Ajanı güncellemek için paneldeki
**Yerel Ajan → JARVIS-Agent.zip** dosyasını indirip yalnızca `app.py` ve `mt5_engine.py` dosyalarını
mevcut klasörünüzün üzerine kopyalayın (`config.json` değişmez), sonra ajanı yeniden başlatın.

## KANAL stratejisi (v2.7)
`kanal_strategy.py` + `mql5/` klasörü: KANAL3BAND bandını kırıp geri dönüş + RSI 70/30 + CCI mor çizgi (CCI MA) kesişimi.
- Ajan, MT5 **Piyasa Gözlemi'nde açık olan tüm pariteleri** seçili zaman dilimlerinde tarar (ayarlar panelde: *KANAL Strateji*).
- 4/4 koşul ilk kez sağlandığında sinyal üretir; JARVIS sesli sorar, yalnızca "Evet" ile emir gider.
- **Ajan güncelleme:** `app.py`, `mt5_engine.py`, `kanal_strategy.py` dosyalarını mevcut klasörün üzerine kopyalayın, ajanı yeniden başlatın.
- **MQL5 dosyaları:** panelde *MQL5 Stratejileri* sayfasında kayıtlıdır; "Derle" ile ajan MetaEditor'da derler
  (`MQL5\\Indicators\\Jarvis\\` ve `MQL5\\Experts\\Jarvis\\` altına yazılır). EA'yı bir grafiğe sürükleyin
  (Algo Trading açık). `InpAutoTrade` varsayılan **false** — yalnızca uyarı verir.
- Centered YSR merkez çizgisi yeniden boyanır; strateji yalnızca kapanmış barlarda sağ uçtaki değerlerle çalışır.

## v2.8 — fiyat akışı, emir doğrulama, güncelleme
- **Canlı fiyat akışı:** ajan her saniye bid/ask gönderir; panel grafiği ve fiyat listesi bununla akar (durum şeridinde "canlı · 0.8 sn").
- **Emir güvenliği:** gönderimden önce Algo Trading, hesap izni, sembol işlem modu, güncel fiyat, SL/TP yönü ve minimum stop mesafesi
  (stops/freeze level + spread) denetlenir. Çok yakın SL/TP otomatik uzatılır; yanlış taraftaki reddedilir. Doldurma modları (IOC/FOK/RETURN)
  sırayla denenir. Red nedeni panelde ve sesli bildirilir; "Tekrar dene" ile yeniden gönderilebilir.
- **Demo/eski sinyaller** gerçek MT5'e asla gitmez; 30 dk'dan eski bekleyen sinyaller süresi dolar.
- **Sembol ekleri** (EURUSD.m, EURUSDm …) otomatik eşlenir.
- **Güncelleme:** `CALISTIR.bat` ile açın → ajan her başlangıçta panelden yeni dosyaları indirir (config.json'a dokunmaz).
