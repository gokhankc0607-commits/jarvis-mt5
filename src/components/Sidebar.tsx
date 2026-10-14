"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";
import PasswordModal from "./PasswordModal";

const NAV = [
  { href: "/dashboard", label: "Komuta Merkezi", icon: "◉" },
  { href: "/market", label: "Piyasa & Grafik", icon: "◭" },
  { href: "/kanal", label: "KANAL Strateji", icon: "◬" },
  { href: "/signals", label: "Sinyaller", icon: "⚡" },
  { href: "/trades", label: "İşlemler", icon: "⇅" },
  { href: "/strategies", label: "MQL5 Stratejileri", icon: "⌘" },
  { href: "/rules", label: "İzleme Kuralları", icon: "◈" },
  { href: "/providers", label: "AI Sağlayıcıları", icon: "✦" },
  { href: "/agent", label: "Yerel Ajan", icon: "⬡" },
  { href: "/phone", label: "Telefon (QR)", icon: "▯" },
];

export default function Sidebar({ name, email }: { name: string; email: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };
  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => {
        const active = path === n.href || path.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setOpen(false)}
            className={cx(
              "group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[15px] font-semibold tracking-wide transition",
              active
                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_-8px_rgba(34,211,238,0.8)]"
                : "border-transparent text-slate-400 hover:border-cyan-400/20 hover:bg-cyan-400/5 hover:text-cyan-200"
            )}
          >
            <span className={cx("w-5 text-center text-lg", active ? "text-cyan-300" : "text-slate-500 group-hover:text-cyan-300")}>{n.icon}</span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
  const brand = (
    <Link href="/dashboard" className="flex items-center gap-3 px-2">
      <div className="relative h-9 w-9 rounded-full border border-cyan-300/60 shadow-[0_0_20px_rgba(34,211,238,0.6)]">
        <div className="absolute inset-1.5 rounded-full bg-gradient-to-br from-white via-cyan-300 to-blue-600" />
      </div>
      <div>
        <div className="neon-text text-lg font-black tracking-[0.35em] text-cyan-100" style={{ fontFamily: "Orbitron" }}>JARVIS</div>
        <div className="-mt-1 text-[10px] tracking-[0.3em] text-cyan-400/70">MT5 · MQL5 · LOCAL AI</div>
      </div>
    </Link>
  );
  const footer = (
    <div className="glass rounded-xl p-3">
      <div className="truncate text-sm font-bold text-slate-200">{name}</div>
      <div className="truncate text-xs text-slate-500">{email}</div>
      <div className="mt-2 flex gap-1.5">
        <button onClick={() => { setOpen(false); setPwOpen(true); }} className="flex-1 rounded-lg border border-slate-600/40 py-1.5 text-xs font-semibold text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200">
          Şifre değiştir
        </button>
        <button onClick={logout} className="flex-1 rounded-lg border border-slate-600/40 py-1.5 text-xs font-semibold text-slate-300 hover:border-rose-400/50 hover:text-rose-300">
          Oturumu kapat
        </button>
      </div>
    </div>
  );

  return (
    <>
      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      <header className="glass sticky top-0 z-40 flex items-center justify-between rounded-none border-x-0 border-t-0 px-4 py-3 lg:hidden">
        {brand}
        <button onClick={() => setOpen(true)} className="rounded-lg border border-cyan-400/30 px-3 py-1.5 text-cyan-200">☰</button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)}>
          <aside className="glass fade-up flex h-full w-72 flex-col gap-6 rounded-none p-4" onClick={(e) => e.stopPropagation()}>
            {brand}
            {nav}
            <div className="mt-auto">{footer}</div>
          </aside>
        </div>
      )}
      <aside className="glass sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-8 rounded-none border-y-0 border-l-0 p-4 lg:flex">
        <div className="pt-2">{brand}</div>
        {nav}
        <div className="mt-auto">{footer}</div>
      </aside>
    </>
  );
}
