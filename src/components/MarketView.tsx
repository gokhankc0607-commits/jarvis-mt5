"use client";

import { useCallback, useEffect, useState } from "react";
import PriceChart, { type ChartInfo } from "./PriceChart";
import RadarTable from "./RadarTable";
import { Spark, SymbolIcon } from "./hud";
import { Badge, Card, Empty, PageHeader, Skeleton, api, cx, fmtNum, fmtPrice } from "./ui";
import { CATEGORY_TABS, type Category } from "@/lib/tf";
import type { MarketT, StateT } from "@/lib/types";

export default function MarketView() {
  const [market, setMarket] = useState<MarketT | null>(null);
  const [state, setState] = useState<StateT | null>(null);
  const [sel, setSel] = useState<{ symbol: string; tf: string } | null>(null);
  const [cat, setCat] = useState<Category | "all">("all");
  const [info, setInfo] = useState<ChartInfo | null>(null);

  const load = useCallback(() => {
    api<MarketT>("/api/market").then(setMarket).catch(() => {});
    api<StateT>("/api/state").then(setState).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(load, 3000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    if (!market?.quotes.length) return;
    if (!sel || !market.quotes.some((q) => q.symbol === sel.symbol)) {
      const want = new URLSearchParams(window.location.search).get("symbol")?.toUpperCase();
      const q = market.quotes.find((x) => x.symbol === want) ?? market.quotes[0];
      setSel({ symbol: q.symbol, tf: q.tfs[0] });
    }
  }, [market, sel]);

  const quotes = (market?.quotes ?? []).filter((q) => cat === "all" || q.category === cat);
  const selQuote = market?.quotes.find((q) => q.symbol === sel?.symbol);
  const myTrades = (state?.openTrades ?? []).filter((t) => t.symbol.toUpperCase() === sel?.symbol);
  const floating = state?.openTrades.reduce((s, t) => s + t.pnl, 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="PİYASA & GRAFİK"
        sub="Takip ettiğin pariteler, canlı grafik, RSI/CCI değerleri ve açık işlemlerin tek ekranda."
        right={market && <Badge tone={market.live ? "green" : "amber"}>{market.live ? "CANLI MT5 VERİSİ" : "DEMO VERİ"}</Badge>}
      />

      {!market ? <Card><Skeleton rows={6} /></Card> : market.quotes.length === 0 ? (
        <Card><Empty icon="◭" title="Takip edilen parite yok" hint="İzleme Kuralları sayfasından bir parite ve zaman dilimleri ekleyin." /></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          {/* Parite listesi */}
          <Card title="Takip Listesi" icon="◈">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {[{ key: "all", label: "Tümü" }, ...CATEGORY_TABS.filter((t) => market.quotes.some((q) => q.category === t.key))].map((t) => (
                <button key={t.key} onClick={() => setCat(t.key as Category | "all")}
                  className={cx("rounded-lg border px-2.5 py-1 text-xs font-bold", cat === t.key ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100" : "border-slate-600/30 text-slate-400 hover:text-cyan-200")}>{t.label}</button>
              ))}
            </div>
            <div className="space-y-1.5">
              {quotes.map((q) => {
                const up = q.changePct >= 0;
                return (
                  <button key={q.symbol} onClick={() => setSel({ symbol: q.symbol, tf: q.tfs.includes(sel?.tf ?? "") ? sel!.tf : q.tfs[0] })}
                    className={cx("w-full rounded-xl border px-3 py-2 text-left transition", sel?.symbol === q.symbol ? "border-cyan-400/50 bg-cyan-400/10" : "border-slate-600/20 hover:border-cyan-400/30")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-bold"><SymbolIcon symbol={q.symbol} category={q.category} size={22} />{q.symbol}{!q.enabled && <Badge tone="slate">kapalı</Badge>}</span>
                      <span className="num font-bold text-slate-100">{fmtPrice(q.price)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className={cx("num text-xs font-semibold", up ? "text-emerald-300" : "text-rose-300")}>{up ? "▲" : "▼"} {Math.abs(q.changePct).toFixed(2)}%</span>
                      <span className={cx("num text-xs font-bold", q.rsi !== null && q.rsi <= 30 ? "text-emerald-300" : q.rsi !== null && q.rsi >= 70 ? "text-rose-300" : "text-slate-300")}>
                        RSI {q.rsi?.toFixed(1) ?? "—"}
                      </span>
                      <span className="num text-xs text-slate-400">CCI {q.cci?.toFixed(0) ?? "—"}</span>
                      <Spark data={q.spark} up={up} w={60} h={20} />
                    </div>
                    {q.signal && <div className="mt-1"><Badge tone={q.signal === "BUY" ? "green" : "red"}>⚡ RSI+CCI uyumu · {q.signal === "BUY" ? "AL" : "SAT"}</Badge></div>}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Grafik */}
          <div className="min-w-0 space-y-4">
            <Card>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {selQuote && <SymbolIcon symbol={selQuote.symbol} category={selQuote.category} size={34} />}
                  <div>
                    <div className="text-2xl font-black leading-none">{sel?.symbol}</div>
                    <div className="mt-1 flex gap-1">
                      {(selQuote?.tfs ?? []).map((tf) => (
                        <button key={tf} onClick={() => setSel({ symbol: sel!.symbol, tf })}
                          className={cx("rounded-md px-2 py-0.5 text-xs font-bold", sel?.tf === tf ? "bg-cyan-400/25 text-cyan-100" : "text-slate-400 hover:text-cyan-200")}>{tf}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <Metric label="RSI" value={info?.rsi?.toFixed(1) ?? "—"} tone={info?.rsi != null && info.rsi <= 30 ? "g" : info?.rsi != null && info.rsi >= 70 ? "r" : undefined} />
                  <Metric label="CCI" value={info?.cci?.toFixed(0) ?? "—"} tone={info?.cci != null && info.cci <= -100 ? "g" : info?.cci != null && info.cci >= 100 ? "r" : undefined} />
                  <div className="text-right">
                    <div className="num text-3xl font-bold leading-none">{fmtPrice(info?.price)}</div>
                    {info && <div className={cx("num text-sm font-semibold", info.change >= 0 ? "text-emerald-300" : "text-rose-300")}>{info.change >= 0 ? "+" : ""}{info.changePct.toFixed(2)}%</div>}
                  </div>
                </div>
              </div>
              {sel && <PriceChart symbol={sel.symbol} tf={sel.tf} height={560} osc onInfo={setInfo} />}
              <p className="mt-1 text-[11px] text-slate-500">Mum + Bollinger(20,2) + hacim · alt paneller: RSI ve CCI (kesikli çizgiler eşikler) · açık işlemlerin giriş/SL/TP çizgileri grafikte görünür.</p>
            </Card>

            <Card title="RSI · CCI Radar" icon="◎" right={<span className="text-xs text-slate-500">satıra tıkla → grafik</span>}>
              <RadarTable rows={market.radar} onSelect={(symbol, tf) => setSel({ symbol, tf })} selected={sel ? `${sel.symbol}|${sel.tf}` : undefined} />
            </Card>

            <Card title="Açık İşlemlerim" icon="⇅" right={
              <span className={cx("num text-sm font-bold", floating >= 0 ? "text-emerald-300" : "text-rose-300")}>Toplam {floating >= 0 ? "+" : ""}{fmtNum(floating)} {state?.account.currency}</span>
            }>
              {!state ? <Skeleton rows={2} /> : state.openTrades.length === 0 ? <Empty icon="⇅" title="Açık işlem yok" /> : (
                <div className="scroll-thin overflow-x-auto">
                  <table className="num w-full min-w-[620px] text-sm">
                    <thead><tr className="text-left text-[10px] uppercase tracking-widest text-slate-500" style={{ fontFamily: "Rajdhani" }}>
                      <th className="pb-1">Sembol</th><th>Yön</th><th>Lot</th><th className="text-right">Giriş</th><th className="text-right">Güncel</th><th className="text-right">SL</th><th className="text-right">TP</th><th className="text-right">K/Z</th>
                    </tr></thead>
                    <tbody>
                      {state.openTrades.map((t) => (
                        <tr key={t.id} className={cx("border-t border-slate-700/30", t.symbol.toUpperCase() === sel?.symbol && "bg-cyan-400/5")}>
                          <td className="py-1.5 font-bold" style={{ fontFamily: "Rajdhani" }}>{t.symbol}{myTrades.includes(t) && " ◂"}</td>
                          <td><Badge tone={t.side === "BUY" ? "green" : "red"}>{t.side}</Badge></td>
                          <td>{t.volume}</td><td className="text-right">{fmtPrice(t.openPrice)}</td><td className="text-right text-cyan-200">{fmtPrice(t.currentPrice)}</td>
                          <td className="text-right text-slate-400">{fmtPrice(t.sl)}</td><td className="text-right text-slate-400">{fmtPrice(t.tp)}</td>
                          <td className={cx("text-right font-bold", t.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{t.pnl >= 0 ? "+" : ""}{fmtNum(t.pnl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "g" | "r" }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={cx("num text-xl font-bold", tone === "g" ? "text-emerald-300" : tone === "r" ? "text-rose-300" : "text-violet-200")}>{value}</div>
    </div>
  );
}
