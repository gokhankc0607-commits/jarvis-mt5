"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import KanalTable from "./KanalTable";
import { Badge, Button, Card, Field, PageHeader, Skeleton, api, cx, timeAgo, useToast } from "./ui";
import { TFS, parseTfs } from "@/lib/tf";
import { KANAL_DEFAULTS, type KanalItem, type KanalParams } from "@/lib/kanal";

type Cfg = { enabled: boolean; timeframes: string; scanAll: boolean; lot: number; params: KanalParams };
type Resp = { settings: Cfg; live: boolean; items: KanalItem[]; watch: string[]; at: number; ruleSymbols: string[] };

export default function KanalView() {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [form, setForm] = useState<Cfg | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [only, setOnly] = useState(true);
  const [adv, setAdv] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Resp>("/api/kanal");
      setData(r);
      setForm((f) => (f && dirty ? f : r.settings));
    } catch {}
  }, [dirty]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load]);

  const patch = (p: Partial<Cfg>, pp?: Partial<KanalParams>) => {
    setForm((f) => (f ? { ...f, ...p, params: { ...f.params, ...pp } } : f));
    setDirty(true);
  };

  const save = async (override?: Partial<Cfg>) => {
    if (!form) return;
    setSaving(true);
    const body = { ...form, ...override };
    try {
      const s = await api<Cfg>("/api/kanal", { method: "PATCH", body });
      setForm(s);
      setDirty(false);
      toast("Strateji ayarları kaydedildi · ajan bir sonraki senkronda uygular");
      load();
    } catch (e) { toast((e as Error).message, "err"); }
    setSaving(false);
  };

  const toggle = async () => {
    if (!form) return;
    const enabled = !form.enabled;
    setForm({ ...form, enabled });
    try { await api("/api/kanal", { method: "PATCH", body: { enabled } }); toast(enabled ? "KANAL stratejisi açık" : "KANAL stratejisi kapalı (eski RSI/CCI taraması)"); }
    catch (e) { setForm({ ...form, enabled: !enabled }); toast((e as Error).message, "err"); }
  };

  const addChart = async (symbol: string) => {
    try {
      await api("/api/rules", { body: { symbol, timeframes: parseTfs(form?.timeframes) } });
      toast(`${symbol} grafik/izleme listesine eklendi`);
      load();
    } catch (e) { toast((e as Error).message, "err"); }
  };

  const p = form?.params;
  const tfs = parseTfs(form?.timeframes);
  const num = (k: keyof KanalParams, step = "1") => (
    <input className="input" type="number" step={step} value={String(p?.[k] ?? "")} onChange={(e) => patch({}, { [k]: Number(e.target.value) } as Partial<KanalParams>)} />
  );
  const items = data?.items ?? [];
  const armed = items.filter((i) => i.armed).length;
  const fresh = items.filter((i) => i.fire).length;
  const near = items.filter((i) => i.stage >= 1).length;

  return (
    <div>
      <PageHeader
        title="KANAL STRATEJİ"
        sub="KANAL3BAND bandını kırıp geri dönüş + RSI + CCI mor çizgi (MA) kesişimi. Piyasa Gözlemi'ndeki tüm pariteler taranır."
        right={data && (
          <div className="flex items-center gap-2">
            <Badge tone={data.live ? "green" : "amber"}>{data.live ? "CANLI · MT5 Piyasa Gözlemi" : "DEMO VERİ"}</Badge>
            <button onClick={toggle} className={cx("relative h-7 w-14 rounded-full border transition", form?.enabled ? "border-cyan-400/60 bg-cyan-400/30" : "border-slate-600 bg-slate-800")} title="Stratejiyi aç/kapat">
              <span className={cx("absolute top-[3px] h-5 w-5 rounded-full transition-all", form?.enabled ? "left-[31px] bg-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.9)]" : "left-[3px] bg-slate-400")} />
            </button>
          </div>
        )}
      />

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Card title="Strateji Kuralları" icon="◈">
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-3">
              <div className="mb-1 font-black text-rose-300">▼ SATIŞ</div>
              <ol className="list-decimal space-y-1 pl-4 text-slate-300">
                <li>Fiyat <b>üst bandı</b> yukarı kırar</li>
                <li>Kapanış tekrar band <b>içine</b> döner</li>
                <li>CCI, mor çizgiyi (CCI MA) <b>aşağı</b> keser</li>
                <li>RSI <b>{p?.rsiOb ?? 70} altında</b>{p?.sellRsiMode === "crossDown" ? " (aşağı kesmiş)" : ""}</li>
              </ol>
            </div>
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3">
              <div className="mb-1 font-black text-emerald-300">▲ ALIŞ</div>
              <ol className="list-decimal space-y-1 pl-4 text-slate-300">
                <li>Fiyat <b>alt bandı</b> aşağı kırar</li>
                <li>Kapanış tekrar band <b>içine</b> döner</li>
                <li>CCI, mor çizgiyi (CCI MA) <b>yukarı</b> keser</li>
                <li>RSI <b>{p?.rsiOs ?? 30}&apos;u yukarı</b> keser{p?.buyRsiMode === "above" ? " (üstünde yeterli)" : ""}</li>
              </ol>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Sinyal yalnızca kapanmış barda ve koşulların <b>ilk kez</b> tamamlandığı anda bir kez oluşur. Sinyal tek başına işlem açmaz:
            JARVIS sana sorar, yalnızca açık bir <b>“Evet”</b> ile emir gider. Take profit merkez çizgi, stop loss kırılımın ucu + ATR payıdır.
          </p>
        </Card>

        <Card title="Ayarlar" icon="⚙" right={dirty ? <Badge tone="amber">kaydedilmedi</Badge> : undefined}>
          {!form ? <Skeleton rows={5} /> : (
            <div className="space-y-4">
              <Field label="Taranacak zaman dilimleri (birden fazla seçebilirsin)">
                <div className="flex flex-wrap gap-1.5">
                  {TFS.map((tf) => {
                    const on = tfs.includes(tf);
                    return (
                      <button key={tf} type="button" onClick={() => { if (on && tfs.length === 1) return; patch({ timeframes: (on ? tfs.filter((x) => x !== tf) : [...tfs, tf]).join(",") }); }}
                        className={cx("rounded-lg border px-3 py-1.5 text-sm font-bold transition", on ? "border-cyan-400/70 bg-cyan-400/20 text-cyan-100" : "border-slate-600/40 text-slate-400 hover:text-cyan-200")}>{tf}</button>
                    );
                  })}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Kırılacak band" hint="Dış bandı kırmak iç bandı da kırmış sayılır; 3 = en hassas">
                  <div className="flex gap-1.5">
                    {([1, 2, 3] as const).map((b) => (
                      <button key={b} onClick={() => patch({}, { band: b })} className={cx("flex-1 rounded-lg border py-1.5 text-xs font-bold", p?.band === b ? "border-cyan-400/70 bg-cyan-400/20 text-cyan-100" : "border-slate-600/40 text-slate-400")}>
                        Band {b}<span className="block text-[10px] font-normal opacity-70">×{[p?.atrMult1, p?.atrMult2, p?.atrMult3][b - 1]}{b === 1 ? " en dış" : b === 3 ? " en iç" : ""}</span>
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Lot (sinyal önerisi)"><input className="input" type="number" step="0.01" value={form.lot} onChange={(e) => patch({ lot: Number(e.target.value) })} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" className="accent-cyan-400" checked={form.scanAll} onChange={(e) => patch({ scanAll: e.target.checked })} />
                MT5 <b>Piyasa Gözlemi&apos;nde açık olan TÜM pariteleri</b> tara <span className="text-xs text-slate-500">(kapalıysa yalnızca İzleme Kuralları)</span>
              </label>

              <button onClick={() => setAdv(!adv)} className="text-xs font-bold text-cyan-400 hover:underline">{adv ? "▾" : "▸"} Gelişmiş ayarlar</button>
              {adv && p && (
                <div className="space-y-3 rounded-xl border border-slate-600/30 bg-black/20 p-3">
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Kırılım bar sayısı">{num("breakLookback")}</Field>
                    <Field label="Kesişim bar sayısı">{num("crossLookback")}</Field>
                    <Field label="SL payı (ATR×)">{num("slBufferAtr", "0.1")}</Field>
                    <Field label="RSI periyot">{num("rsiPeriod")}</Field>
                    <Field label="RSI üst">{num("rsiOb")}</Field>
                    <Field label="RSI alt">{num("rsiOs")}</Field>
                    <Field label="CCI periyot">{num("cciPeriod")}</Field>
                    <Field label="CCI MA periyot">{num("cciMaPeriod")}</Field>
                    <Field label="Half period">{num("halfLength")}</Field>
                    <Field label="ATR periyot">{num("atrPeriod")}</Field>
                    <Field label="Çarpan 1">{num("atrMult1", "0.1")}</Field>
                    <Field label="Çarpan 2">{num("atrMult2", "0.1")}</Field>
                    <Field label="Çarpan 3">{num("atrMult3", "0.1")}</Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="SATIŞ için RSI">
                      <select className="input" value={p.sellRsiMode} onChange={(e) => patch({}, { sellRsiMode: e.target.value as KanalParams["sellRsiMode"] })}>
                        <option value="below">{p.rsiOb} altında (varsayılan)</option><option value="crossDown">{p.rsiOb}&apos;i aşağı kesmiş</option>
                      </select>
                    </Field>
                    <Field label="ALIŞ için RSI">
                      <select className="input" value={p.buyRsiMode} onChange={(e) => patch({}, { buyRsiMode: e.target.value as KanalParams["buyRsiMode"] })}>
                        <option value="crossUp">{p.rsiOs}&apos;u yukarı kesmiş (varsayılan)</option><option value="above">{p.rsiOs} üstünde</option>
                      </select>
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" className="accent-cyan-400" checked={p.breakByClose} onChange={(e) => patch({}, { breakByClose: e.target.checked })} />
                    Kırılım için kapanış gerekli (kapalıysa fitil yeterli)
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => patch({}, KANAL_DEFAULTS)}>Varsayılana dön</Button>
                </div>
              )}
              <div className="flex justify-end"><Button loading={saving} disabled={!dirty} onClick={() => save()}>Kaydet</Button></div>
            </div>
          )}
        </Card>
      </div>

      <Card
        title={`Piyasa Gözlemi Taraması${data ? ` · ${data.watch.length} parite × ${tfs.length} TF` : ""}`}
        icon="◎"
        right={
          <span className="flex items-center gap-3 text-xs">
            {fresh > 0 && <Badge tone="amber">{fresh} yeni sinyal</Badge>}
            <Badge tone={armed ? "green" : "slate"}>{armed} tam koşul</Badge>
            <Badge tone="cyan">{near} yaklaşan</Badge>
            <label className="flex cursor-pointer items-center gap-1.5 text-slate-300"><input type="checkbox" className="accent-cyan-400" checked={only} onChange={(e) => setOnly(e.target.checked)} />yalnızca yaklaşanlar</label>
          </span>
        }
      >
        {!data ? <Skeleton rows={5} /> : (
          <>
            {data.live && data.at > 0 && Date.now() - data.at > 30000 && <div className="mb-2 rounded-lg bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">Son tarama {timeAgo(new Date(data.at))} — ajan kapalı olabilir.</div>}
            {data.live && data.items.length === 0 && (
              <div className="mb-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs text-slate-300">
                Ajan bağlı ama henüz tarama verisi gelmedi. Ajanı güncelleyin (<Link href="/agent" className="text-cyan-300 underline">Yerel Ajan</Link>: app.py, mt5_engine.py, kanal_strategy.py) ve yeniden başlatın.
              </div>
            )}
            <KanalTable items={data.items} onlyActive={only} rsiOb={p?.rsiOb} rsiOs={p?.rsiOs} ruleSymbols={data.ruleSymbols} onAdd={(s) => addChart(s)}
              onSelect={(s) => { if (data.ruleSymbols.includes(s.toUpperCase())) window.location.href = `/market?symbol=${s}`; }} />
          </>
        )}
        <p className="mt-3 text-[11px] text-slate-500">
          Koşullar sırasıyla: <b>Band</b> kırıldı → <b>Dönüş</b> band içine kapanış → <b>CCI</b> MA kesişimi → <b>RSI</b> şartı. 4/4 olduğunda JARVIS sana sesli sorar.
          {!data?.live && " Demo modunda sentetik veri taranır; gerçek pariteler için ajanı çalıştırın."}
        </p>
      </Card>

      <Card title="MQL5 dosyaları" icon="⌘" className="mt-4">
        <p className="text-sm text-slate-300">
          Üç gösterge ve strateji EA&apos;sı <Link href="/strategies" className="text-cyan-300 underline">MQL5 Stratejileri</Link> sayfasında kayıtlı; &quot;Derle&quot; ile ajan MetaEditor&apos;da derler.
          <b> KANAL Strateji EA</b> bir grafiğe takılınca Piyasa Gözlemi&apos;ndeki tüm pariteleri tarar ve <u>varsayılan olarak yalnızca uyarı verir</u> (otomatik emir kapalı). Gösterge dosyaları: KANAL3BAND, KANAL-CCI, KANAL-RSI-PANEL.
        </p>
      </Card>
    </div>
  );
}
