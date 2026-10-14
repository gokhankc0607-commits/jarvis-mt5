import { and, asc, desc, eq, ilike, ne } from "drizzle-orm";
import { db } from "@/db";
import { messages, signals, trades, accountState, strategies } from "@/db/schema";
import { withUser } from "@/lib/api";
import { callLLM, getActiveProvider, type ChatMsg } from "@/lib/llm";
import { compileStrategy, decideSignal, isAgentOnline } from "@/lib/actions";
import { isNo, isYes, normalizeTr } from "@/lib/intent";

export async function GET() {
  return withUser(async (u) => {
    const rows = await db.select().from(messages).where(eq(messages.userId, u.id)).orderBy(desc(messages.createdAt)).limit(40);
    return Response.json(rows.reverse());
  });
}

export async function DELETE() {
  return withUser(async (u) => {
    await db.delete(messages).where(eq(messages.userId, u.id));
    return Response.json({ ok: true });
  });
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function POST(req: Request) {
  return withUser(async (u) => {
    const { text } = await req.json();
    const input = String(text ?? "").trim();
    if (!input) throw new Error("Mesaj boş");
    await db.insert(messages).values({ userId: u.id, role: "user", content: input });

    // Canlı modda (ajan çevrimiçi) demo/örnek sinyal ve işlemler görünmez — /api/state ile aynı kural.
    const online = await isAgentOnline(u.id);
    const liveSig = online ? ne(signals.source, "demo") : undefined;
    const openTrades = async () => {
      const rows = await db.select().from(trades).where(and(eq(trades.userId, u.id), eq(trades.status, "open")));
      return online ? rows.filter((x) => x.source === "agent") : rows;
    };
    const [pending] = await db
      .select()
      .from(signals)
      .where(and(eq(signals.userId, u.id), eq(signals.status, "pending"), liveSig))
      .orderBy(desc(signals.createdAt))
      .limit(1);
    const t = normalizeTr(input);
    let reply = "";
    let action: string | null = null;

    // Önce RED kontrolü: "hayır" / "iptal" içeren bir cümle asla onay sayılmaz (isYes de olumsuzluk içerenleri reddeder).
    if (pending && isNo(input)) {
      await decideSignal(u.id, pending.id, false);
      action = "signal_rejected";
      reply = `Anlaşıldı, ${pending.symbol} ${pending.side} fırsatı reddedildi. İzlemeye devam ediyorum.`;
    } else if (pending && isYes(input)) {
      const r = await decideSignal(u.id, pending.id, true);
      action = "signal_approved";
      reply =
        r.status === "approved"
          ? `Onay alındı. ${pending.symbol} ${pending.side} ${pending.volume} lot emri MT5'e gönderiliyor efendim.`
          : `Onay alındı. ${pending.symbol} ${pending.side} işlemi demo modunda açıldı. Ajan bağlandığında gerçek emirler MT5'e gidecek.`;
    } else if (/^(durum|bakiye|hesap|rapor)/.test(t)) {
      const [a] = await db.select().from(accountState).where(eq(accountState.userId, u.id));
      const open = await openTrades();
      const pnl = open.reduce((s, x) => s + x.pnl, 0);
      reply = `Bakiye ${fmt(a?.balance ?? 0)} ${a?.currency ?? "USD"}, varlık ${fmt(a?.equity ?? 0)}, serbest teminat ${fmt(a?.freeMargin ?? 0)}. ${open.length} açık işlem, toplam yüzen kâr/zarar ${fmt(pnl)}.${pending ? ` Bekleyen sinyal: ${pending.symbol} ${pending.side}.` : ""}`;
    } else if (/^derle\b/.test(t)) {
      const q = input.replace(/^derle\s*/i, "").trim();
      const [st] = q
        ? await db.select().from(strategies).where(and(eq(strategies.userId, u.id), ilike(strategies.name, `%${q}%`))).limit(1)
        : await db.select().from(strategies).where(eq(strategies.userId, u.id)).orderBy(desc(strategies.updatedAt)).limit(1);
      if (!st) reply = "Bu isimde bir strateji bulamadım.";
      else {
        const job = await compileStrategy(u.id, st.id, true);
        action = "compile";
        reply =
          job.status === "queued"
            ? `${st.name} derleme kuyruğuna alındı. MetaEditor çalıştırılıyor.`
            : job.status === "success"
            ? `${st.name} başarıyla derlendi. ${job.warnings} uyarı.`
            : `${st.name} derlemesinde ${job.errors} hata var. Logları Stratejiler sayfasında inceleyebilirsiniz.`;
      }
    } else {
      const p = await getActiveProvider(u.id);
      const [a] = await db.select().from(accountState).where(eq(accountState.userId, u.id));
      const open = await openTrades();
      const hist = await db.select().from(messages).where(eq(messages.userId, u.id)).orderBy(desc(messages.createdAt)).limit(10);
      const ctx = `Hesap: bakiye ${a?.balance}, varlık ${a?.equity}, serbest teminat ${a?.freeMargin}. Açık işlemler: ${
        open.map((o) => `${o.symbol} ${o.side} ${o.volume} lot PnL ${o.pnl}`).join("; ") || "yok"
      }. Bekleyen sinyal: ${pending ? `${pending.symbol} ${pending.side} (${pending.reason})` : "yok"}.`;
      const msgs: ChatMsg[] = [
        {
          role: "system",
          content: `Sen JARVIS'sin: kullanıcının MT5 algoritmik işlem ve MQL5 geliştirme asistanı. Türkçe, kısa (en fazla 3 cümle), saygılı ("efendim") ve net konuş. Kullanıcı açıkça "evet" demeden asla işlem açma. Bağlam: ${ctx}`,
        },
        ...hist.reverse().map((m) => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: m.content })),
      ];
      if (p) {
        try {
          reply = await callLLM(p, msgs, 60000);
        } catch {
          reply = `Yerel zekâ çekirdeğine (${p.name} - ${p.baseUrl}) ulaşamıyorum efendim. Ollama veya LM Studio'nun çalıştığından emin olun. Bu arada "durum", "derle <strateji>", "evet" veya "hayır" komutlarını işleyebilirim.`;
        }
      } else {
        reply = "Aktif bir AI sağlayıcısı yok efendim. AI Sağlayıcıları sayfasından Ollama veya LM Studio'yu etkinleştirin.";
      }
    }

    const [saved] = await db.insert(messages).values({ userId: u.id, role: "assistant", content: reply }).returning();
    return Response.json({ reply, action, message: saved });
  });
}
