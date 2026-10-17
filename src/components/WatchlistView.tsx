"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Empty, PageHeader, Skeleton, api, cx, fmtPrice, useToast } from "./ui";
import { SymbolIcon } from "./hud";
import { categoryOf } from "@/lib/tf";
import type { KanalItem } from "@/lib/kanal";

type Cfg = { scanMode: "list" | "marketwatch"; symbols: string[]; timeframes: string };
type Resp = { settings: Cfg; live: boolean; items: KanalItem[]; watch: string[]; marketWatch: string[]; ruleSymbols: string[] };

const POPULAR = ["EURUSD", "GBPUSD", "USDJPY", "GBPJPY", "EURJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "US30", "US100", "US500", "GER40", "USOIL"];

/** Takip listesi: KANAL stratejisi yalnızca bu pariteleri tarar ve işlemleri bunlardan açar. */
export default function WatchlistView() {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [mode, setMode] = useState<"list" | "marketwatch">("list");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<Resp>("/api/kanal");
      setData(r);
      if (!dirty) {
        setList(r.settings.symbols);
        setMode(r.settings.scanMode);
      }
    } catch {}
  }, [dirty]);
  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const add = (raw: string) => {
    const syms = raw.toUpperCase().split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[A-Z0-9._#+-]{2,20}$/.test(x));
    if (!syms.length) return;
    setList((l) => [...l, ...syms.filter((s) => !l.includes(s))].slice(0, 80));
    setDirty(true);
    setInput("");
  };
  const remove = (s: string) => { setList((l) => l.filter((x) => x !== s)); setDirty(true); };
  const toggle = (s: string) => (list.includes(s) ? remove(s) : add(s));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api<Cfg>("/api/kanal", { method: "PATCH", body: { symbols: list, scanMode: mode } });
      setList(r.symbols);
      setMode(r.scanMode);
      setDirty(false);
      toast(`Takip listesi kaydedildi · ${r.scanMode === "marketwatch" ? "Piyasa Gözlemi'nin tamamı" : `${r.symbols.length} parite`} taranacak`);
      load();
    } catch (e) { toast((e as Error).message, "err"); }
    setSaving(false);
  };

  const mw = data?.marketWatch ?? [];
  const source = mw.length ? mw : POPULAR;
  const filtered = useMemo(() => source.filter((s) => !q || s.toUpperCase().includes(q.toUpperCase())), [source, q]);
  const itemOf = (s: string) => (data?.items ?? []).filter((i) => i.symbol.toUpperCase() === s.toUpperCase()).sort((a, b) => b.stage - a.stage)[0];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="TAKİP LİSTESİ"
        sub="KANAL stratejisi yalnızca bu listedeki pariteleri tarar ve işlemleri bunlardan açar. Grafik ve fiyatlar da bu pariteler için akar."
        right={<div className="flex items-center gap-2">{dirty && <Badge tone="amber">kaydedilmedi</Badge>}<Button loading={saving} disabled={!dirty} onClick={save}>Kaydet</Button></div>}
      />

      <Card title="Ne taransın?" icon="◎" className="mb-4">
        <div className="grid gap-2 md:grid-cols-2">
          {([
            ["list", "☰ Yalnızca takip listem", "Aşağıda seçtiğin pariteler. Liste boşsa İzleme Kuralları'ndaki pariteler kullanılır."],
            ["marketwatch", "◫ Piyasa Gözlemi'nin tamamı", "MT5 Piyasa Gözlemi'nde açık olan TÜM semboller (önceki davranış)."],
          ] as const).map(([k, t, d]) => (
            <button key={k} onClick={() => { setMode(k); setDirty(true); }}
              className={cx("rounded-xl border p-3 text-left transition", mode === k ? "border-cyan-400/60 bg-cyan-400/10 shadow-[0_0_20px_-8px_rgba(34,211,238,0.9)]" : "border-slate-600/40 hover:border-cyan-400/30")}>
              <div className={cx("font-bold", mode === k ? "text-cyan-100" : "text-slate-300")}>{t}</div>
              <div className="mt-0.5 text-xs text-slate-400">{d}</div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Zaman dilimleri: <b className="text-slate-300">{data?.settings.timeframes ?? "—"}</b> · <Link href="/kanal" className="text-cyan-300 underline">KANAL Strateji</Link> sayfasından değiştirilir.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card title={`Takip listem (${list.length})`} icon="☰" className={cx(mode === "marketwatch" && "opacity-60")}
          right={list.length > 0 && <button onClick={() => { if (confirm("Liste temizlensin mi?")) { setList([]); setDirty(true); } }} className="text-xs text-slate-500 hover:text-rose-300">temizle</button>}>
          <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(input); }}>
            <input className="input" list="wl-src" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="Parite ekle (örn. NAS100, XAUUSD — virgülle birden fazla)" />
            <datalist id="wl-src">{source.map((s) => <option key={s} value={s} />)}</datalist>
            <Button type="submit" disabled={!input.trim()}>Ekle</Button>
          </form>
          {!data ? <Skeleton rows={4} /> : list.length === 0 ? (
            <Empty icon="☰" title="Takip listen boş" hint={`Şimdilik İzleme Kuralları'ndaki pariteler taranıyor${data.ruleSymbols.length ? `: ${data.ruleSymbols.join(", ")}` : ""}. Sağdan parite seç ya da yukarıya yaz.`} />
          ) : (
            <div className="space-y-1.5">
              {list.map((s) => {
                const it = itemOf(s);
                const missing = data.live && mw.length > 0 && !mw.some((m) => m.toUpperCase() === s);
                return (
                  <div key={s} className="flex items-center gap-2 rounded-xl border border-slate-600/25 bg-black/20 px-3 py-2">
                    <SymbolIcon symbol={s} category={categoryOf(s)} size={22} />
                    <span className="w-24 font-bold text-white">{s}</span>
                    <span className="num w-24 text-right text-sm text-slate-300">{it ? fmtPrice(it.price) : "—"}</span>
                    <span className="flex-1 text-xs">
                      {missing ? <span className="text-amber-300">Piyasa Gözlemi&apos;nde yok — MT5&apos;te ekleyin ya da adını kontrol edin</span>
                        : it && it.stage >= 1 ? <span className={cx("font-bold", it.armed ? "text-emerald-300" : "text-amber-300")}>{it.side === "BUY" ? "▲" : "▼"} {it.tf} · {it.stage}/5 koşul</span>
                        : <span className="text-slate-500">izleniyor</span>}
                    </span>
                    <button onClick={() => remove(s)} className="rounded-md px-2 py-0.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300" title="Listeden çıkar">✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title={mw.length ? `MT5 Piyasa Gözlemi (${mw.length})` : "Popüler pariteler"} icon="◫"
          right={<input className="input !w-40 !py-1 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ara…" />}>
          {!data?.live && <p className="mb-2 text-xs text-slate-500">Ajan bağlanınca burada MT5 Piyasa Gözlemi&apos;ndeki semboller (brokerdaki adlarıyla, örn. NAS100, DJ30) listelenir.</p>}
          <div className="flex max-h-[460px] flex-wrap gap-1.5 overflow-y-auto scroll-thin">
            {filtered.map((s) => {
              const on = list.includes(s.toUpperCase());
              return (
                <button key={s} onClick={() => toggle(s.toUpperCase())}
                  className={cx("rounded-lg border px-2.5 py-1 text-sm font-semibold transition", on ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-100" : "border-slate-600/40 text-slate-300 hover:border-cyan-400/40 hover:text-cyan-100")}>
                  {on ? "✓ " : "+ "}{s}
                </button>
              );
            })}
            {filtered.length === 0 && <span className="text-sm text-slate-500">Sonuç yok.</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}
