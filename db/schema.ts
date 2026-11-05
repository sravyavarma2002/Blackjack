import { pgTable, text, numeric, timestamp, bigserial, jsonb, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// One row per player, keyed by their Netlify Identity user id.
export const profiles = pgTable(
  "profiles",
  {
    id: text().primaryKey(),
    email: text().notNull().default(""),
    displayName: text("display_name").notNull().default(""),
    username: text(),
    hometown: text().notNull().default(""),
    bio: text().notNull().default(""),
    bank: numeric({ mode: "number" }).notNull().default(1000),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("profiles_username_lower_key").on(sql`lower(${t.username})`)]
);

// Every finished round of blackjack.
export const rounds = pgTable(
  "rounds",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    strategy: text().notNull().default("Just playing"),
    betTotal: numeric("bet_total", { mode: "number" }).notNull(),
    net: numeric({ mode: "number" }).notNull(),
    bankAfter: numeric("bank_after", { mode: "number" }).notNull(),
    dealerUp: text("dealer_up").notNull(),
    dealerCards: jsonb("dealer_cards").notNull().default([]),
    trueCount: numeric("true_count", { mode: "number" }).notNull().default(0),
    startHand: text("start_hand").notNull().default(""),
    hands: jsonb().notNull().default([]),
    mistakes: jsonb().notNull().default([]),
    decisions: integer().notNull().default(0),
    blackjack: boolean().notNull().default(false),
  },
  (t) => [index("rounds_user_created").on(t.userId, t.createdAt)]
);
