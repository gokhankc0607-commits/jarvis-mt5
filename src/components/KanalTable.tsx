"use client";

import { Badge, cx, fmtPrice } from "./ui";
import { RsiGauge, SymbolIcon } from "./hud";
import { categoryOf } from "@/lib/tf";
import type { KanalItem } from "@/lib/kanal";

const STAGE_TXT = ["Beklemede", "Band kırıldı", "Band içine döndü", "3/5 koşul", "4/5 · yön onayı bekleniyor", "5/5 · SİNYAL"];

function Chip({ ok, label, active }: { ok: boolean; label: string; active: boolean }) {
  return (
    <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-bold", !active ? "bg-slate-800/60 text-slate-600" : ok ? "bg-emerald-400/20 text-emerald-300" : "bg-slate-700/40 text-slate-500")}>
      {ok && active ? "✓" : "·"} {label}
    </span>
  );
}

/** KANAL stratejisi tarama tablosu: her satırda koşulların durumu (band kırıldı → içeri kapanış → CCI → RSI → sıra → yön) + güven. */
export default function KanalTable({
  items, limit, onlyActive = false, rsiOb = 70, rsiOs = 30, autoMin, ruleSymbols, onAdd, onSelect,
}: {
  items: KanalItem[]; limit?: number; onlyActive?: boolean; rsiOb?: number; rsiOs?: number; autoMin?: number;
  ruleSymbols?: string[]; onAdd?: (symbol: string, tf: string) => void; onSelect?: (symbol: string, tf: string) => void;
}) {
  let list = onlyActive ? items.filter((i) => i.stage >= 1) : items;
  if (limit) list = list.slice(0, limit);
  if (!list.length)
    return (
      <div className="rounded-xl border border-dashed border-cyan-400/20 py-6 text-center text-sm text-slate-400">
        {items.length === 0 ? "Henüz tarama verisi yok." : "Şu an bandı kırıp dönen kurulum yok. Piyasa Gözlemi'ndeki pariteleri izlemeye devam ediyorum…"}
      </div>
    );
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
            <th className="pb-1.5">Parite</th><th>TF</th><th className="text-right">Fiyat</th><th>Band</th><th>RSI</th><th className="text-right">CCI / MA</th><th>Koşullar</th><th className="text-right">Güven</th><th className="text-right">Durum</th>
          </tr>
        </thead>
        <tbody>
          {list.map((i) => {
            const act = i.stage > 0;
            const inRules = ruleSymbols?.includes(i.symbol.toUpperCase());
            return (
              <tr key={`${i.symbol}|${i.tf}`} onClick={() => onSelect?.(i.symbol, i.tf)} className={cx("hud-row border-t border-slate-700/30", onSelect && "cursor-pointer", i.fire && "bg-amber-400/5")}>
                <td className="py-1.5">
                  <span className="flex items-center gap-2 font-bold"><SymbolIcon symbol={i.symbol} category={categoryOf(i.symbol)} size={20} />{i.symbol}</span>
                </td>
                <td><Badge tone="slate">{i.tf}</Badge></td>
                <td className="num text-right text-slate-200">{fmtPrice(i.price)}</td>
                <td>
                  <span className={cx("text-xs font-bold", i.pos === "above" ? "text-rose-300" : i.pos === "below" ? "text-emerald-300" : "text-slate-500")}>
                    {i.pos === "above" ? "▲ üst band dışı" : i.pos === "below" ? "▼ alt band dışı" : "içeride"}
                  </span>
                </td>
                <td><RsiGauge value={i.rsi} os={rsiOs} ob={rsiOb} /></td>
                <td className="num text-right text-xs">
                  <span className={cx("font-bold", i.cci !== null && i.cciMa !== null && i.cci > i.cciMa ? "text-emerald-300" : "text-rose-300")}>{i.cci === null ? "—" : i.cci.toFixed(0)}</span>
                  <span className="text-purple-300"> / {i.cciMa === null ? "—" : i.cciMa.toFixed(0)}</span>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <Chip ok={i.checks.brk} label="Band" active={act} />
                    <Chip ok={i.checks.ret} label="Dönüş" active={act} />
                    <Chip ok={i.checks.cci} label="CCI" active={act} />
                    <Chip ok={i.checks.rsi} label="RSI" active={act} />
                    <Chip ok={!!i.checks.seq} label="Sıra" active={act} />
                    <Chip ok={!!i.checks.agree} label="Yön" active={act} />
                  </div>
                </td>
                <td className="num text-right text-xs">
                  {act && i.confidence ? (
                    <span className={cx("font-bold", i.confidence >= (autoMin ?? 80) ? "text-amber-200" : "text-slate-300")} title={i.confidence >= (autoMin ?? 80) ? "Otomatik işlem eşiğinin üstünde" : undefined}>
                      %{i.confidence}{i.confidence >= (autoMin ?? 80) ? " ⚡" : ""}
                    </span>
                  ) : <span className="text-slate-600">—</span>}
                </td>
                <td className="text-right">
                  {i.side && i.stage >= 2 ? (
                    <span className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-black",
                      i.armed ? (i.side === "BUY" ? "border-emerald-400/60 bg-emerald-400/20 text-emerald-200" : "border-rose-400/60 bg-rose-400/20 text-rose-200") : "border-slate-500/40 text-slate-300")}>
                      {i.side === "BUY" ? "▲ AL" : "▼ SAT"} · {i.fire ? "YENİ!" : STAGE_TXT[i.stage]}
                    </span>
                  ) : i.stage === 1 ? (
                    <span className="text-xs text-amber-300">{i.side === "BUY" ? "▼ alt" : "▲ üst"} {STAGE_TXT[1].toLowerCase()}</span>
                  ) : <span className="text-xs text-slate-600">—</span>}
                  {onAdd && ruleSymbols && !inRules && (
                    <button onClick={(e) => { e.stopPropagation(); onAdd(i.symbol, i.tf); }} className="ml-2 rounded border border-cyan-400/30 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-400/10" title="Grafikte görmek için izleme listesine ekle">+ grafik</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
