# JARVIS — Windows'ta Kurulum

## 1) Komuta Merkezi (panel) — http://localhost:3000
1. Bu klasörde **`PANEL_KUR.bat`** dosyasına çift tıklayın (ilk sefer).
   - Node.js yoksa kurar. **PostgreSQL GEREKMEZ** — gömülü veritabanı (`data\jarvis.db.tgz`) kullanılır.
2. Tarayıcı açılır: **http://localhost:3000** → `demo@jarvis.local` / `jarvis123`
3. Sonraki açılışlarda sadece **`PANEL_BASLAT.bat`**.

### Erişim ve güvenlik
- Varsayılan başlatma panele **yalnızca bu bilgisayardan** erişime izin verir (127.0.0.1).
- Telefon/QR için paneli **ağ modunda** açın: **`PANEL_BASLAT.bat lan`** (ya da `.env.local` içine `JARVIS_LAN=1`).
  Ağ modunda aynı Wi-Fi'deki herkes giriş sayfasını görür → **demo şifresini değiştirin** (sol alt menü → *Şifre değiştir*).
  Başarısız girişler sınırlandırılır (hesap başına 8 / 10 dk).
- Paneli internete açmayın; uzaktan erişim için VPN (ör. Tailscale) kullanın.

> Harici PostgreSQL kullanmak isterseniz `.env.local` içine
> `DATABASE_URL=postgresql://kullanici:sifre@127.0.0.1:5432/jarvis` yazın. Tablolar ilk açılışta otomatik oluşturulur;
> isterseniz `npx drizzle-kit push` da aynı ayarı `.env.local`'den okur. `PANEL_KUR.bat` mevcut `.env.local` dosyasına dokunmaz.

## 2) Yerel Ajan (JARVIS.exe) — MT5 + ses + derleyici
1. Panelde **Yerel Ajan** → **⬇ JARVIS-Agent.zip** (Panel URL otomatik `http://localhost:3000` olur).
2. Zip'i çıkartın → **`KUR.bat`**.

## Veriler / yedek
Tüm panel verileri tek dosyadadır: `data\jarvis.db.tgz` (bir önceki oturum: `.bak`). Yedek için bu dosyayı kopyalayın.

## Güncelleme (baştan kurmak gerekmez)
- **Panel:** yeni dosyaları eski klasörün üzerine çıkartın. `data\` (veriler) ve `.env.local` projede olmadığı için silinmez.
  Sonra `PANEL_BASLAT.bat` — `VERSION` değiştiyse kendisi yeniden derler (npm paketlerini de günceller).
- **Ajan:** `CALISTIR.bat` ile açın; ajan her başlangıçta panelden yeni dosyaları indirir, `config.json`'a dokunmaz.
  EXE kullanıyorsanız güncelleme paketini çıkartıp `build_exe.bat --no-models` çalıştırın.
- Güncelleme paketi: panel → Yerel Ajan → "Güncelleme paketi (config.json içermez)".
