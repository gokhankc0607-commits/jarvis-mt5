"use client";

import { useState } from "react";
import { Button, Field, Modal, api, useToast } from "./ui";

/** Şifre değiştirme penceresi (kenar menü ve komuta merkezi menüsünden açılır). */
export default function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setCurrent(""); setNext(""); setAgain("");
    onClose();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) { toast("Yeni şifreler aynı değil", "err"); return; }
    setBusy(true);
    try {
      await api("/api/auth/password", { body: { current, next } });
      toast("Şifre değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.", "ok");
      close();
    } catch (err) {
      toast((err as Error).message, "err");
    }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={close} title="Şifre değiştir">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-slate-400">
          Panel ağ modunda (<code className="text-cyan-200">PANEL_BASLAT.bat lan</code>) çalışıyorsa aynı Wi-Fi&apos;deki herkes giriş sayfasını görür;
          varsayılan <code className="text-cyan-200">jarvis123</code> şifresini mutlaka değiştirin.
        </p>
        <Field label="Mevcut şifre"><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
        <Field label="Yeni şifre" hint="En az 8 karakter"><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required /></Field>
        <Field label="Yeni şifre (tekrar)"><input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} minLength={8} required /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close}>Vazgeç</Button>
          <Button type="submit" loading={busy}>Kaydet</Button>
        </div>
      </form>
    </Modal>
  );
}
