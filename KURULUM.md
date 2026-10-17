# JARVIS — Windows'ta Kurulum

## 1) Komuta Merkezi (panel) — http://localhost:3000
1. Bu klasörde **`PANEL_KUR.bat`** dosyasına çift tıklayın (ilk sefer).
   - Node.js yoksa kurar. **PostgreSQL GEREKMEZ** — gömülü veritabanı (`%APPDATA%\JARVIS\jarvis.db.tgz`) kullanılır.
2. Tarayıcı açılır: **http://localhost:3000** → `demo@jarvis.local` / `jarvis123`
3. Sonraki açılışlarda sadece **`PANEL_BASLAT.bat`**.

> Harici PostgreSQL kullanmak isterseniz `.env.local` içine
> `DATABASE_URL=postgresql://kullanici:sifre@127.0.0.1:5432/jarvis` yazın ve `npx drizzle-kit push` çalıştırın.

## 2) Yerel Ajan (JARVIS.exe) — MT5 + ses + derleyici
1. Panelde **Yerel Ajan** → **⬇ JARVIS-Agent.zip** (Panel URL otomatik `http://localhost:3000` olur).
2. Zip'i çıkartın → **`KUR.bat`**.

## Veriler / yedek
Tüm panel verileri `%APPDATA%\JARVIS\jarvis.db.tgz` dosyasındadır (bir önceki oturum: `.bak`). Yedek için bu dosyayı kopyalayın.

## Güncelleme — RAR / ZIP'ten Direkt Klasöre Çekme (`PANEL_GUNCELLE.bat`)
Yeni bir `.rar` veya `.zip` sürümü indirdiğinizde yeni klasör açmanıza gerek yoktur:
1. **`PANEL_GUNCELLE.bat`** dosyasına çift tıklayın *(veya indirdiğiniz `.rar` / `.zip` dosyasını doğrudan `PANEL_GUNCELLE.bat` üzerine sürükleyip bırakın)*.
2. Betik otomatik olarak **İndirilenler (`Downloads`)** klasöründeki en yeni JARVIS `.rar` / `.zip` arşivini bulur (isterseniz dosya seçici penceresinden başka bir `.rar`/`.zip` seçebilir veya GitHub'dan çekebilirsiniz).
3. Arşivi (WinRAR, 7-Zip veya Windows yerleşik `tar` ile) açar, içindeki güncel dosyaları **doğrudan mevcut klasöre** aktarır (`data\`, `%APPDATA%\JARVIS\jarvis.db.tgz`, `.env.local` ve `config.json` ayarlarınıza dokunmaz), paneli yeniden derler ve başlatır.
- **Ajan:** `CALISTIR.bat` (veya `GUNCELLE.bat`) ile açın; ajan her başlangıçta panelden yeni dosyaları indirir, `config.json`'a dokunmaz.

## Sohbet / sesli komutlar (v2.9)
- Emir: `EURUSD 0.1 lot al sl 30 tp 60` · `altın sat` · `buy gir` → JARVIS özetler, **Evet** deyince MT5'e gider.
- SL/TP: `SL girişe çek` · `xauusd sl 4150 yap` · `tp 80 pip` · `sl kaldır` · `hepsinin SL girişe çek`
- Kapat: `NAS100 kapat` · `hepsini kapat` (onay ister) · Durum: `durum`

## Otomatik işlem (v3.0)
Panel → **KANAL Strateji** → **Otomatik İşlem** anahtarı (varsayılan kapalı). Açıkken: tüm koşullar + güven ≥ %80 → JARVIS sormadan girer,
fiyat TP yolunun %30'unu geçince SL girişe çekilir.

## KANAL stratejisi v2 (v3.1)
Tüm bantların dışında kesin kapanış + RSI 30/70 kesişimi + CCI mor çizgi kesişimi. SL = RSI kesişiminden önceki dip/tepe,
TP = merkez çizgi. Zaman dilimleri: 3dk / 5dk / 15dk / 1sa (KANAL Strateji sayfasından).
EA kullanıyorsanız `KANAL_Strateji.mq5`'i MQL5 Stratejileri sayfasından yeniden derleyin.

## Veriler nerede? (v3.1.1)
Panel verileri `%APPDATA%\JARVIS\jarvis.db.tgz` dosyasındadır — paneli yeni bir klasöre çıkartsanız da aynı veriler ve aynı ajan anahtarı kullanılır.
İlk açılışta eski klasörlerdeki (`...\data\jarvis.db.tgz`) en yeni veri otomatik kopyalanır.

## v3.2 & v3.2.1
- **Takip Listesi** (kenar menü): KANAL yalnızca buradaki pariteleri tarar.
- **Yarı kâr al:** TP yolunun %50'sinde lotun yarısı kapatılır (KANAL Strateji → Kâr yönetimi). İşlemler sayfasında "½ Kapat".
- **İşlem zaman dilimi:** Ajan açtığı her pozisyonun TF'sini `tf_map.json`'a kaydeder ve panele bildirir; elle açılan işlemlerde "＋TF" ile atanabilir.
- **Kenar menü** tüm sayfalarda; « / » ile daraltılıp genişletilir.

## v3.3 — Telegram Bot + Piyasa & Grafik Zaman Dilimi
- **Telegram Bot** (kenar menü → *Telegram Bot*): Bot token + Chat ID girin. Sinyal geldiğinde kanal teması/taşması, RSI durumu, CCI/mor çizgi, Giriş-SL-TP ve R:R bilgisiyle bildirim gelir; altındaki **✅ Evet gir / ❌ Hayır / 📊 Panelde aç / 🔕 30 dk sessiz** düğmeleriyle doğrudan telefondan yönetilir.
- **Piyasa & Grafik → Zaman Dilimi:** Seçilen zaman dilimi tüm paritelere uygulanır (fiyat, değişim, RSI, grafik, radar).
