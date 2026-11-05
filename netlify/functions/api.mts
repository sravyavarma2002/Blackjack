import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { profiles, rounds } from "../../db/schema.js";

const json = (data: unknown, status = 200) => Response.json(data, { status });

function profileOut(p: typeof profiles.$inferSelect) {
  return {
    display_name: p.displayName,
    username: p.username ?? "",
    hometown: p.hometown,
    bio: p.bio,
    bank: Number(p.bank),
    created_at: p.createdAt,
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function ensureProfile(id: string, email: string) {
  const [existing] = await db.select().from(profiles).where(eq(profiles.id, id));
  if (existing) return existing;
  await db.insert(profiles).values({ id, email }).onConflictDoNothing();
  const [created] = await db.select().from(profiles).where(eq(profiles.id, id));
  return created;
}

export default async (req: Request) => {
  const user = await getUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const path = new URL(req.url).pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const profile = await ensureProfile(user.id, user.email ?? "");

  if (path === "profile" && req.method === "GET") return json(profileOut(profile));

  if (path === "profile" && req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    const patch: Partial<typeof profiles.$inferInsert> = {};
    if ("bank" in body) {
      const bank = Number(body.bank);
      if (!Number.isFinite(bank) || bank < 0) return json({ error: "Invalid bank" }, 400);
      patch.bank = bank;
    }
    if ("display_name" in body) patch.displayName = str(body.display_name, 60);
    if ("hometown" in body) patch.hometown = str(body.hometown, 80);
    if ("bio" in body) patch.bio = str(body.bio, 280);
    if ("username" in body) {
      const u = str(body.username, 20);
      if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) return json({ error: "Invalid username" }, 400);
      patch.username = u;
    }
    if (!Object.keys(patch).length) return new Response(null, { status: 204 });
    try {
      await db.update(profiles).set(patch).where(eq(profiles.id, user.id));
    } catch (e: any) {
      const code = e?.code ?? e?.cause?.code;
      if (code === "23505") return json({ error: "Username taken" }, 409);
      throw e;
    }
    return new Response(null, { status: 204 });
  }

  if (path === "rounds" && req.method === "GET") {
    const rows = await db
      .select()
      .from(rounds)
      .where(eq(rounds.userId, user.id))
      .orderBy(asc(rounds.createdAt))
      .limit(20000);
    return json(
      rows.map((r) => ({
        created_at: r.createdAt,
        strategy: r.strategy,
        bet_total: Number(r.betTotal),
        net: Number(r.net),
        bank_after: Number(r.bankAfter),
        dealer_up: r.dealerUp,
        dealer_cards: r.dealerCards,
        true_count: Number(r.trueCount),
        start_hand: r.startHand,
        hands: r.hands,
        mistakes: r.mistakes,
        decisions: r.decisions,
        blackjack: r.blackjack,
      }))
    );
  }

  if (path === "rounds" && req.method === "POST") {
    const b = await req.json().catch(() => null);
    if (!b) return json({ error: "Invalid round" }, 400);
    await db.insert(rounds).values({
      userId: user.id,
      createdAt: isNaN(Date.parse(b.created_at)) ? new Date() : new Date(b.created_at),
      strategy: str(b.strategy, 80) || "Just playing",
      betTotal: num(b.bet_total),
      net: num(b.net),
      bankAfter: num(b.bank_after),
      dealerUp: str(b.dealer_up, 10),
      dealerCards: Array.isArray(b.dealer_cards) ? b.dealer_cards : [],
      trueCount: num(b.true_count),
      startHand: str(b.start_hand, 40),
      hands: Array.isArray(b.hands) ? b.hands : [],
      mistakes: Array.isArray(b.mistakes) ? b.mistakes : [],
      decisions: Math.trunc(num(b.decisions)),
      blackjack: !!b.blackjack,
    });
    return json({ ok: true }, 201);
  }

  return json({ error: "Not found" }, 404);
};

export const config: Config = { path: ["/api/profile", "/api/rounds"] };
