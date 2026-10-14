"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Skeleton, api, cx, fmtNum, fmtPrice, timeAgo, useList, useToast } from "./ui";
import OrderTicket from "./OrderTicket";
import type { Trade } from "@/lib/types";

const blank = { symbol: "", side: "BUY", volume: "0.1", openPrice: "", sl: "", tp: "", comment: "" };

export default function TradesView() {
  const toast = useToast();
  const { data, setData, reload } = useList<Trade>("/api/trades");
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [form, setForm] = useState<typeof blank | null>(null);
  const [edit, setEdit] = useState<Trade | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => fetch("/api/state").then(() => reload()), 4000);
    return () => clearInterval(iv);
  }, [reload]);

  const list = (data ?? []).filter((t) => (tab === "open" ? t.status !== "closed" : t.status === "closed"));
  const closed = (data ?? []).filter((t) => t.status === "closed");
  const realized = closed.reduce((s, t) => s + t.pnl, 0);
  const wins = closed.filter((t) => t.pnl > 0).length;
  const floating = (data ?? []).filter((t) => t.status !== "closed").reduce((s, t) => s + t.pnl, 0);

  const close = async (t: Trade) => {
    if (!confirm(`#${t.ticket} ${t.symbol} kapatılsın mı?`)) return;
    const prev = data;
    setData((d) => d?.map((x) => (x.id === t.id ? { ...x, status: "closing" } : x)) ?? d);
    try {
      const r = await api<Trade>(`/api/trades/${t.id}`, { method: "PATCH", body: { action: "close" } });
      setData((d) => d?.map((x) => (x.id === t.id ? r : x)) ?? d);
      toast(r.status === "closing" ? "Kapatma emri ajana iletildi" : "İşlem kapatıldı");
    } catch (e) { setData(prev); toast((e as Error).message, "err"); }
  };
  const del = async (t: Trade) => {
    if (!confirm("Kayıt silinsin mi?")) return;
    const prev = data;
    setData((d) => d?.filter((x) => x.id !== t.id) ?? d);
    try { await api(`/api/trades/${t.id}`, { method: "DELETE" }); toast("Silindi"); } catch (e) { setData(prev); toast((e as Error).message, "err"); }
  };
  const create = async () => {
    if (!form) return;
    setBusy(true);
    try { const r = await api<Trade>("/api/trades", { body: form }); setData((d) => [r, ...(d ?? [])]); setForm(null); toast("İşlem kaydedildi"); }
    catch (e) { toast((e as Error).message, "err"); }
    setBusy(false);
  };
  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try { const r = await api<Trade>(`/api/trades/${edit.id}`, { method: "PATCH", body: { sl: edit.sl, tp: edit.tp, comment: edit.comment } }); setData((d) => d?.map((x) => (x.id === r.id ? r : x)) ?? d); setEdit(null); toast("Güncellendi"); }
    catch (e) { toast((e as Error).message, "err"); }
    setBusy(false);
  };

  return (
    <div>
      <PageHeader title="İŞLEMLER" sub="MT5 pozisyonları canlı senkronize edilir. Manuel kayıtlar günlük amaçlıdır." right={<div className="flex gap-2"><Button variant="success" onClick={() => setOrderOpen(true)}>＋ Hızlı Emir</Button><Button variant="ghost" onClick={() => setForm({ ...blank })}>+ Manuel Kayıt</Button></div>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Yüzen K/Z" value={fmtNum(floating)} tone={floating >= 0 ? "g" : "r"} />
        <Kpi label="Gerçekleşen K/Z" value={fmtNum(realized)} tone={realized >= 0 ? "g" : "r"} />
        <Kpi label="Kazanma Oranı" value={closed.length ? `%${Math.round((wins / closed.length) * 100)}` : "—"} />
        <Kpi label="Toplam İşlem" value={String(data?.length ?? 0)} />
      </div>
      <div className="mb-3 flex gap-2">
        {(["open", "closed"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={cx("rounded-lg border px-3 py-1 text-sm font-semibold", tab === k ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100" : "border-slate-600/30 text-slate-400")}>
            {k === "open" ? "Açık" : "Kapalı"}
          </button>
        ))}
      </div>
      <Card>
        {!data ? <Skeleton rows={5} /> : list.length === 0 ? (
          <Empty icon="⇅" title={tab === "open" ? "Açık işlem yok" : "Kapalı işlem yok"} hint="Sinyalleri onayladığınızda işlemler burada görünür." />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
                <th className="pb-2">Bilet</th><th>Sembol</th><th>Yön</th><th>Lot</th><th>Açılış</th><th>Güncel</th><th>SL / TP</th><th className="text-right">K/Z</th><th>Zaman</th><th />
              </tr></thead>
              <tbody style={{ fontFamily: "JetBrains Mono" }}>
                {list.map((t) => (
                  <tr key={t.id} className="border-t border-slate-700/30 hover:bg-cyan-400/5">
                    <td className="py-2 text-xs text-slate-400">#{t.ticket}{t.source !== "agent" && <span className="ml-1 text-[9px] text-amber-400/80">{t.source}</span>}</td>
                    <td className="font-bold">{t.symbol}</td>
                    <td><Badge tone={t.side === "BUY" ? "green" : "red"}>{t.side}</Badge></td>
                    <td>{t.volume}</td>
                    <td>{fmtPrice(t.openPrice)}</td>
                    <td>{fmtPrice(t.currentPrice)}</td>
                    <td className="text-xs text-slate-400">{fmtPrice(t.sl)} / {fmtPrice(t.tp)}</td>
                    <td className={cx("text-right font-bold", t.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{t.pnl >= 0 ? "+" : ""}{fmtNum(t.pnl)}</td>
                    <td className="text-xs text-slate-500" style={{ fontFamily: "Rajdhani" }}>{timeAgo(t.closedAt ?? t.openedAt)}</td>
                    <td className="whitespace-nowrap text-right">
                      {t.status === "open" && <><Button size="sm" variant="ghost" onClick={() => setEdit({ ...t })}>✎</Button> <Button size="sm" variant="danger" onClick={() => close(t)}>Kapat</Button></>}
                      {t.status === "closing" && <Badge tone="violet">Kapatılıyor</Badge>}
                      {t.status === "closed" && <Button size="sm" variant="ghost" onClick={() => del(t)}>🗑</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <OrderTicket open={orderOpen} onClose={() => { setOrderOpen(false); reload(); }} />
      <Modal open={!!form} onClose={() => setForm(null)} title="Manuel İşlem Kaydı">
        {form && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sembol"><input className="input" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} /></Field>
            <Field label="Yön"><select className="input" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}><option>BUY</option><option>SELL</option></select></Field>
            <Field label="Lot"><input className="input" value={form.volume} onChange={(e) => setForm({ ...form, volume: e.target.value })} /></Field>
            <Field label="Açılış fiyatı"><input className="input" value={form.openPrice} onChange={(e) => setForm({ ...form, openPrice: e.target.value })} /></Field>
            <Field label="SL"><input className="input" value={form.sl} onChange={(e) => setForm({ ...form, sl: e.target.value })} /></Field>
            <Field label="TP"><input className="input" value={form.tp} onChange={(e) => setForm({ ...form, tp: e.target.value })} /></Field>
            <div className="col-span-2"><Field label="Not"><input className="input" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></Field></div>
            <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)}>İptal</Button><Button loading={busy} onClick={create}>Kaydet</Button></div>
          </div>
        )}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`#${edit?.ticket ?? ""} Düzenle`}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="SL"><input className="input" value={edit.sl ?? ""} onChange={(e) => setEdit({ ...edit, sl: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="TP"><input className="input" value={edit.tp ?? ""} onChange={(e) => setEdit({ ...edit, tp: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <div className="col-span-2"><Field label="Not"><input className="input" value={edit.comment} onChange={(e) => setEdit({ ...edit, comment: e.target.value })} /></Field></div>
            <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>İptal</Button><Button loading={busy} onClick={saveEdit}>Kaydet</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "g" | "r" }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={cx("mt-1 text-xl font-bold tabular-nums", tone === "g" ? "text-emerald-300" : tone === "r" ? "text-rose-300" : "text-cyan-100")} style={{ fontFamily: "JetBrains Mono" }}>{value}</div>
    </div>
  );
}
