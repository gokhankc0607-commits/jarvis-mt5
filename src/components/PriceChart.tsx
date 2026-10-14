"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, LineSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp,
} from "lightweight-charts";
import { type Candle, type RadarCfg } from "@/lib/indicators";
import { kanalSeries, KANAL_DEFAULTS, type KanalParams } from "@/lib/kanal";
import { Spinner } from "./ui";

type TradeLine = { side: string; volume: number; openPrice: number; sl: number | null; tp: number | null };
type Resp = { live: boolean; candles: Candle[]; ageMs: number | null; tick: { bid: number; ask: number; age: number; stale: number } | null; cfg: RadarCfg; kp?: KanalParams; trades: TradeLine[] };
export type ChartInfo = { price: number | null; change: number; changePct: number; rsi: number | null; cci: number | null; live: boolean; tickAge: number | null; dataAge: number | null; stale: number };

const T = (n: number) => n as UTCTimestamp;
const UP = "rgba(255,82,82,0.9)";
const DN = "rgba(0,230,118,0.9)";

/** Mum + KANAL3BAND (merkez + 3 üst + 3 alt bant) + hacim. osc: altında RSI ve CCI(+MA mor çizgi) panelleri. */
export default function PriceChart({
  symbol, tf, height = 260, osc = false, refreshMs = 2000, onInfo,
}: { symbol: string; tf: string; height?: number; osc?: boolean; refreshMs?: number; onInfo?: (i: ChartInfo) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const S = useRef<{
    candle?: ISeriesApi<"Candlestick">; vol?: ISeriesApi<"Histogram">;
    center?: ISeriesApi<"Line">; up: ISeriesApi<"Line">[]; dn: ISeriesApi<"Line">[];
    rsi?: ISeriesApi<"Line">; cci?: ISeriesApi<"Line">; cciMa?: ISeriesApi<"Line">;
    lines: IPriceLine[]; ref: { ser: ISeriesApi<"Line">; line: IPriceLine }[]; fitted: string;
  }>({ up: [], dn: [], lines: [], ref: [], fitted: "" });
  const [state, setState] = useState<"loading" | "ok" | "empty">("loading");
  const infoRef = useRef(onInfo);
  infoRef.current = onInfo;

  /* ---- grafiği oluştur ---- */
  useEffect(() => {
    if (!box.current) return;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#7fb4e6", fontSize: 11, panes: { separatorColor: "rgba(56,189,248,0.25)" } },
      grid: { vertLines: { color: "rgba(56,189,248,0.06)" }, horzLines: { color: "rgba(56,189,248,0.08)" } },
      rightPriceScale: { borderColor: "rgba(56,189,248,0.25)" },
      timeScale: { borderColor: "rgba(56,189,248,0.25)", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;
    const s: typeof S.current = { up: [], dn: [], lines: [], ref: [], fitted: "" };
    S.current = s;
    s.candle = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399", downColor: "#fb7185", wickUpColor: "#34d399", wickDownColor: "#fb7185", borderVisible: false,
    });
    const base = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    for (let k = 0; k < 3; k++) {
      s.up.push(chart.addSeries(LineSeries, { ...base, color: UP }));
      s.dn.push(chart.addSeries(LineSeries, { ...base, color: DN }));
    }
    s.center = chart.addSeries(LineSeries, { ...base, color: "#2962ff", lineWidth: 2 });
    s.vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    if (osc) {
      s.rsi = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 2, priceLineVisible: false, title: "RSI" }, 1);
      s.cci = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 2, priceLineVisible: false, title: "CCI" }, 2);
      s.cciMa = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "MA" }, 2);
      const panes = chart.panes();
      panes[0]?.setStretchFactor(3.2);
      panes[1]?.setStretchFactor(1);
      panes[2]?.setStretchFactor(1);
    }
    return () => {
      chart.remove();
      chartRef.current = null;
      S.current = { up: [], dn: [], lines: [], ref: [], fitted: "" };
    };
  }, [osc]);

  /* ---- veriyi çek ve çiz ---- */
  useEffect(() => {
    let dead = false;
    setState("loading");
    const load = async () => {
      try {
        const r = await fetch(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: "no-store" });
        if (r.status === 401) { window.location.href = "/login"; return; }
        const j = (await r.json()) as Resp;
        if (dead || !chartRef.current) return;
        const s = S.current;
        const off = j.live ? 0 : -new Date().getTimezoneOffset() * 60; // demo: yerel saat
        const cs = j.candles;
        if (!cs.length) { setState("empty"); return; }
        const t = (c: Candle) => T(c.time + off);
        // Kullanıcı canlı uçtaysa, yeni mum eklendiğinde görünümü kaydır (aksi halde son fiyat ekran dışında kalır)
        const ts0 = chartRef.current.timeScale();
        const atEdge = s.fitted === `${symbol}|${tf}` ? ts0.scrollPosition() >= 0 : false;
        s.candle?.setData(cs.map((c) => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
        s.vol?.setData(cs.map((c) => ({ time: t(c), value: c.volume, color: c.close >= c.open ? "rgba(52,211,153,0.3)" : "rgba(251,113,133,0.3)" })));
        const toLine = (arr: (number | null)[]) => arr.flatMap((v, i) => (v === null ? [] : [{ time: t(cs[i]), value: v }]));

        const kp = j.kp ?? KANAL_DEFAULTS;
        const ks = kanalSeries(cs, kp);
        s.center?.setData(toLine(ks.center));
        for (let k = 0; k < 3; k++) {
          const sel = kp.band === k + 1;
          s.up[k]?.setData(toLine(ks.up[k]));
          s.dn[k]?.setData(toLine(ks.dn[k]));
          s.up[k]?.applyOptions({ lineWidth: sel ? 2 : 1 });
          s.dn[k]?.applyOptions({ lineWidth: sel ? 2 : 1 });
        }
        if (osc) {
          s.rsi?.setData(toLine(ks.rsi));
          s.cci?.setData(toLine(ks.cci));
          s.cciMa?.setData(toLine(ks.cciMa));
          s.ref.forEach((r) => r.ser.removePriceLine(r.line));
          s.ref = [];
          const mk = (ser: ISeriesApi<"Line"> | undefined, price: number, color: string) => {
            if (ser) s.ref.push({ ser, line: ser.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" }) });
          };
          mk(s.rsi, kp.rsiOb, "rgba(251,113,133,0.8)"); mk(s.rsi, kp.rsiOs, "rgba(52,211,153,0.8)");
          mk(s.cci, 200, "rgba(251,113,133,0.6)"); mk(s.cci, -200, "rgba(52,211,153,0.6)"); mk(s.cci, 0, "rgba(148,163,184,0.5)");
        }

        // açık işlem çizgileri
        s.lines.forEach((l) => s.candle?.removePriceLine(l));
        s.lines = [];
        for (const tr of j.trades) {
          const col = tr.side === "BUY" ? "#34d399" : "#fb7185";
          const add = (price: number | null, color: string, title: string, style: LineStyle) => {
            if (price && s.candle) s.lines.push(s.candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
          };
          add(tr.openPrice, col, `${tr.side} ${tr.volume}`, LineStyle.Solid);
          add(tr.sl, "#f43f5e", "SL", LineStyle.Dashed);
          add(tr.tp, "#22c55e", "TP", LineStyle.Dashed);
        }
        const key = `${symbol}|${tf}`;
        if (s.fitted !== key) {
          const n = cs.length;
          chartRef.current.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 4 });
          s.fitted = key;
        } else if (atEdge) {
          chartRef.current.timeScale().scrollToRealTime();
        }

        const last = cs[cs.length - 1].close;
        const n = cs.length;
        const back = Math.max(1, Math.min(n - 1, 96));
        const ref = cs[n - 1 - back].close;
        infoRef.current?.({ price: last, change: last - ref, changePct: ((last - ref) / ref) * 100, rsi: ks.rsi[n - 1], cci: ks.cci[n - 1], live: j.live, tickAge: j.tick?.age ?? null, dataAge: j.ageMs === null ? null : j.ageMs / 1000, stale: j.tick?.stale ?? 0 });
        setState("ok");
      } catch {
        if (!dead) setState((p) => (p === "loading" ? "empty" : p));
      }
    };
    S.current.fitted = "";
    load();
    const iv = setInterval(load, refreshMs);
    return () => { dead = true; clearInterval(iv); };
  }, [symbol, tf, osc, refreshMs]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={box} className="absolute inset-0" />
      {state !== "ok" && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-slate-400">
          {state === "loading" ? <span className="flex items-center gap-2"><Spinner /> grafik yükleniyor…</span> : (
            <span>
              Bu parite/zaman dilimi için veri yok.<br />
              <span className="text-xs text-slate-500">Canlı modda ajan, izleme kuralındaki pariteleri gönderir (ajanı güncelleyin).</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
