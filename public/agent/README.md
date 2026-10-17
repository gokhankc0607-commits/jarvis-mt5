# JARVIS Yerel Ajan

| Modül | Görev |
|---|---|
| `mt5_engine.py` | MT5 bağlantısı, fiyat/mum, RSI·CCI·Stoch·ATR, uyumsuzluk, onaylı emir |
| `mql5_compiler.py` | .mq5 oku/yaz, `metaeditor64.exe /compile`, log parse, otonom LLM düzeltme |
| `local_ai.py` | Ollama / LM Studio / OmniRoute (+ opsiyonel bulut), faster-whisper STT, Piper TTS |
| `app.py` | Ana çalıştırıcı: panel senkronu, sesli onay, derleme işçisi, "Jarvis" uyandırma |
| `jarvis_launcher.py` | EXE giriş noktası + kurulum sihirbazı (otomatik MT5 yolu bulma, bağlantı testi) |

## Python sürümü
MetaTrader5 kütüphanesi yalnızca **64-bit Python 3.6–3.14** için yayınlanır. Derleme betikleri
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

## v2.9 — sohbet / sesli emirler, SL-TP değiştirme, broker sembol adları
- **Sohbetten / sesle emir:** "EURUSD 0.1 lot al sl 30 tp 60", "altın sat", "buy gir" (grafikteki parite) → JARVIS özetler, **"Evet"** ile MT5'e gider ve sonucu söyler.
- **SL/TP değiştirme MT5'e gider** (`TRADE_ACTION_SLTP`): "SL girişe çek", "xauusd sl 4150 yap", "tp 80 pip", "sl kaldır", "hepsinin SL girişe çek". İşlemler sayfasında **SL→Giriş** düğmesi.
- **Kapatma:** "NAS100 kapat", "hepsini kapat" (birden çok işlemde onay ister).
- **Broker sembol adları otomatik eşlenir:** US100 → NAS100/USTEC, US30 → DJ30/WS30, XAUUSD → GOLD, EURUSD → EURUSD.m … Bulunamazsa benzer adları önerir.

## v3.0 — Otomatik işlem (isteğe bağlı), yeni SL/TP, girişe çekme
- **Otomatik işlem** (panel → KANAL Strateji → Otomatik İşlem, varsayılan KAPALI): fiyat band içine döndü + RSI + CCI onayı (4/4) ve
  **güven ≥ %80** ise JARVIS sormadan işleme girer; altındaysa yine sorar. Otomatik pozisyonlar ayrı magic (`magic+1`) ve `JARVIS AUTO` yorumuyla açılır.
  Aynı paritede açık pozisyon varsa atlar; en fazla N otomatik pozisyon.
- **Güven puanı:** 45 + 12×kırılan band + RSI gücü (0-10) + CCI–MA farkı (0-5) + risk/ödül (0-5).
- **SL:** ALIŞ → bandın dönüş yaptığı dip, SATIŞ → dönüş tepesi (+0.1×ATR pay); istenirse "bir önceki dip/tepe".
- **TP:** ALIŞ → girişin üstündeki en yakın üst band, SATIŞ → altındaki en yakın alt band.
- **SL girişe çekme:** fiyat TP'ye olan mesafenin %30'unu kâra geçince SL giriş fiyatına çekilir (ayarlanabilir).

## v3.1 — KANAL stratejisi v2 (yeni kural)
- **Zaman dilimleri:** yalnızca 3dk / 5dk / 15dk / 1sa (panelden seçilir).
- **ALIŞ:** mum TÜM alt bantların (en dış bant) dışında KAPANIR → RSI 30 altında → RSI 30'u yukarı keser → CCI mor çizgiyi yukarı keser.
- **SATIŞ:** mum TÜM üst bantların dışında KAPANIR → RSI 70 üstünde → RSI 70'i aşağı keser → CCI mor çizgiyi aşağı keser.
- **SL:** ALIŞ → RSI 30'u yukarı kesmeden önceki en düşük fiyat · SATIŞ → RSI 70'i aşağı kesmeden önceki en yüksek fiyat.
- **TP:** bandın merkez çizgisi (ilk hedef). Otomatik işlem / güven eşiği / %30'da girişe çekme aynen çalışır.
- **EA:** `mql5/KANAL_Strateji.mq5` v3.10 aynı kuralla; girişlerden M3/M5/M15/H1 seçilir, Piyasa Gözlemi taranır.
- **Güven:** 60 + bant dışı derinlik (0-10) + RSI aşırılığı (0-15) + CCI–MA farkı (0-5) + risk/ödül (0-10).

## v3.1.1 — düzeltmeler
- **`cublas64_12.dll` hatası:** bilgisayarda NVIDIA GPU var ama CUDA 12 kütüphaneleri yoksa ses tanıma artık otomatik **CPU**'ya geçer
  (açılışta test edilir; çalışırken hata olursa da geçer). GPU için: `.venv\Scripts\pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"`.
- **Ses döngüsü çökmez:** hata olursa kaydedilir ve devam eder; üst üste 5 hatada dinleme kapanır, onaylar panelden verilir.
- **Ajan anahtarı:** panel anahtarı reddederse (401) açık uyarı verilir ve kurulum penceresi kendiliğinden açılır.
- **Panel verileri** artık `%APPDATA%\JARVIS\jarvis.db.tgz` içinde (proje klasöründen bağımsız). Eski klasörlerdeki veri ilk açılışta otomatik kopyalanır.

## v3.2 — geri dönüş şartı, yarı kâr al, takip listesi, işlem zaman dilimi
- **Strateji:** bant dışı kapanış sonrası fiyat **bantların içine dönmeden** işlem açılmaz (5 koşul). RSI/CCI kesişimi en fazla 10 mum önce
  olabilir ve şu an hâlâ onaylı olmalı; sinyal genelde içeri dönüş mumunda çıkar.
- **Yarı kâr al:** fiyat TP yolunun %50'sine ulaşınca lotun yarısı kapatılır (ayarlanabilir). %30'da SL girişe. JARVIS'in açtığı tüm işlemlerde
  (sinyal onayı, hızlı emir, otomatik) çalışır. Panelde "½ Kapat", sohbette "yarısını kapat".
- **Takip listesi:** strateji yalnızca seçtiğin pariteleri tarar (Panel → Takip Listesi). İstenirse Piyasa Gözlemi'nin tamamı.
- **İşlem zaman dilimi:** emir yorumu artık TF içerir ("JARVIS BUY M15 #12", "JARVIS AUTO M5"); panelde her işlemin TF'si görünür.

## v3.2.1 — işlem zaman dilimi düzeltmesi
- Zaman dilimi artık MT5 yorumuna bağlı değil (brokerlar yorumu silebiliyor): ajan açtığı her pozisyonun TF'sini `tf_map.json`'a kaydeder
  ve panele bildirir. Ek yedekler: bilet numarası → sinyal, yorum ("KANAL BUY PERIOD_M15" dahil), #sinyal numarası.
- MT5'te elle açılan işlemlerde TF bilinemez: İşlemler sayfasında "＋TF"ye tıklayıp elle atayabilirsiniz.

## v3.3 — Telegram bot + Piyasa & Grafik zaman dilimi seçimi
- **Telegram** (Panel → Telegram Bot): bot token + chat ID. Sinyal geldiğinde bildirim: hangi kanala temas ettiği / kanal taşması,
  o anki RSI durumu (değer + aşırı alım/satım notu), CCI/mor çizgi, giriş-SL-TP ve R:R. Düğmeler: ✅ Evet gir / ❌ Hayır / 📊 Panelde aç / 🔕 30 dk sessiz.
  Düğmelerin çalışması için ajan açık olmalı (ajan `getUpdates` ile dinler, eylemi panele iletir; işlem kuralları aynen uygulanır).
- **Piyasa & Grafik → Zaman Dilimi:** seçtiğin dil bütün paritelere uygulanır (fiyat, değişim, RSI, grafik, radar). “Tümü” ile eski hâle dönülür.
