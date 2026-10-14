import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import CommandCenter from "@/components/CommandCenter";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Tam ekran HUD komuta merkezi (kenar menüsüz). */
export default async function DashboardPage() {
  const u = await getUser();
  if (!u) redirect("/login");
  return (
    <ToastProvider>
      <div className="pointer-events-none fixed inset-0 grid-bg" />
      <div className="relative">
        <CommandCenter />
      </div>
    </ToastProvider>
  );
}
