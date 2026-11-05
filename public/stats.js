/* Stats: filtering, aggregation, chart markup and CSV/JSON export. No DOM access, so it is easy to test. */
(function (root) {
  "use strict";
  const B = root.BJ || {};

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const signedMoney = (n) => (n > 0 ? "+" : "") + money(n);
  const pct = (x) => (isFinite(x) ? Math.round(x * 100) + "%" : "–");

  const RANGES = { all: 0, "30d": 30 * 864e5, "7d": 7 * 864e5, "24h": 864e5 };

  function filterRounds(rounds, f) {
    f = f || {};
    const cutoff = RANGES[f.range || "all"] ? Date.now() - RANGES[f.range] : 0;
    return rounds.filter((r) =>
      (!f.strategy || f.strategy === "all" || r.strategy === f.strategy) &&
      (!cutoff || new Date(r.created_at).getTime() >= cutoff));
  }

  const allHands = (rounds) => rounds.flatMap((r) => (r.hands || []).map((h) => Object.assign({ round: r }, h)));

  function profileStats(rounds) {
    const hands = allHands(rounds);
    const won = hands.filter((h) => h.result === "win").length;
    const lost = hands.filter((h) => h.result === "loss").length;
    const push = hands.filter((h) => h.result === "push").length;
    return {
      hands: hands.length, won, lost, push,
      winRate: hands.length ? won / hands.length : NaN,
      blackjacks: hands.filter((h) => h.blackjack).length,
      biggestWin: rounds.reduce((m, r) => Math.max(m, Number(r.net) || 0), 0)
    };
  }

  /* ---------- chart pieces ---------- */
  function bars(items, opt) {
    opt = opt || {};
    if (!items.length) return '<p class="muted">Not enough data yet.</p>';
    const max = opt.max || Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
    return '<div class="bars">' + items.map((i) => {
      let fill = "";
      if (i.empty) fill = "";
      else if (opt.signed) {
        const w = Math.min(50, (Math.abs(i.value) / max) * 50);
        fill = `<span class="bar-fill ${i.value < 0 ? "neg" : ""}" style="${i.value < 0 ? "right" : "left"}:50%;width:${w}%"></span>`;
      } else {
        fill = `<span class="bar-fill" style="left:0;width:${Math.min(100, (i.value / max) * 100)}%"></span>`;
      }
      return `<div class="bar-row"><span class="bar-label">${esc(i.label)}</span>` +
        `<span class="bar-track${opt.signed ? " signed" : ""}">${fill}</span>` +
        `<span class="bar-val">${esc(i.text)}</span></div>`;
    }).join("") + "</div>";
  }

  function lineChart(values, baseline) {
    if (values.length < 2) return '<p class="muted">Play at least two rounds to see your bankroll over time.</p>';
    let pts = values;
    if (pts.length > 600) { const k = Math.ceil(pts.length / 600); pts = pts.filter((_, i) => i % k === 0 || i === pts.length - 1); }
    const W = 640, H = 220, L = 54, R = 12, T = 12, Bm = 22;
    const lo = Math.min(baseline, ...pts), hi = Math.max(baseline, ...pts);
    const span = hi - lo || 1;
    const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / span) * (H - T - Bm);
    const path = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" class="line" role="img" aria-label="Bank after each round, from ${money(values[0])} to ${money(values[values.length - 1])}">` +
      `<line x1="${L}" x2="${W - R}" y1="${y(baseline)}" y2="${y(baseline)}" class="base"/>` +
      `<path d="${path}" class="trace"/>` +
      `<text x="${L - 6}" y="${T + 4}" text-anchor="end">${money(hi)}</text>` +
      `<text x="${L - 6}" y="${H - Bm}" text-anchor="end">${money(lo)}</text>` +
      `<text x="${L}" y="${H - 4}">Round 1</text>` +
      `<text x="${W - R}" y="${H - 4}" text-anchor="end">Round ${values.length}</text></svg>`;
  }

  const section = (title, sub, body) =>
    `<section class="stat-sec"><h3>${esc(title)}</h3>${sub ? `<p class="muted">${esc(sub)}</p>` : ""}${body}</section>`;

  /* ---------- aggregates ---------- */
  function byStrategy(rounds) {
    const map = {};
    rounds.forEach((r) => {
      const m = map[r.strategy] || (map[r.strategy] = { name: r.strategy, rounds: 0, net: 0, hands: 0, won: 0, decisions: 0, mistakes: 0 });
      m.rounds++; m.net += Number(r.net) || 0;
      (r.hands || []).forEach((h) => { m.hands++; if (h.result === "win") m.won++; });
      m.decisions += r.decisions || 0;
      m.mistakes += (r.mistakes || []).length;
    });
    return Object.values(map).sort((a, b) => b.rounds - a.rounds);
  }

  function mistakeList(rounds) {
    const map = {};
    rounds.forEach((r) => (r.mistakes || []).forEach((m) => {
      const k = `${m.situation}: you ${m.played.toLowerCase()}, basic strategy says ${m.correct.toLowerCase()}`;
      map[k] = (map[k] || 0) + 1;
    }));
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }

  function insights(rounds, strategies, mistakes) {
    const out = [];
    const net = rounds.reduce((a, r) => a + (Number(r.net) || 0), 0);
    out.push(`You've played ${rounds.length} round${rounds.length === 1 ? "" : "s"} and are ${net >= 0 ? "up" : "down"} ${money(Math.abs(net))} (${signedMoney(net / rounds.length)} per round).`);

    const decisions = rounds.reduce((a, r) => a + (r.decisions || 0), 0);
    const errs = rounds.reduce((a, r) => a + (r.mistakes || []).length, 0);
    if (decisions >= 20) out.push(`You followed basic strategy on ${pct(1 - errs / decisions)} of your ${decisions} decisions.`);
    if (mistakes.length) out.push(`Your most common mistake: ${mistakes[0][0]} (${mistakes[0][1]} time${mistakes[0][1] === 1 ? "" : "s"}).`);

    const ranked = strategies.filter((s) => s.rounds >= 10).sort((a, b) => b.net / b.rounds - a.net / a.rounds);
    if (ranked.length >= 2) out.push(`Best strategy so far: ${ranked[0].name}, averaging ${signedMoney(ranked[0].net / ranked[0].rounds)} per round.`);

    const hot = rounds.filter((r) => r.true_count >= 2), cold = rounds.filter((r) => r.true_count <= -2);
    if (hot.length >= 10 && cold.length >= 10) {
      const avg = (a) => a.reduce((s, r) => s + (Number(r.net) || 0), 0) / a.length;
      out.push(`When the true count was +2 or higher you averaged ${signedMoney(avg(hot))} per round, versus ${signedMoney(avg(cold))} when it was -2 or lower.`);
    }
    return out;
  }

  function statsHtml(rounds) {
    if (!rounds.length) return '<p class="empty">No hands in this view yet. Play a few rounds on the Table tab, or widen the filters.</p>';

    const strategies = byStrategy(rounds);
    const mistakes = mistakeList(rounds);
    const hands = allHands(rounds);

    // insights
    const ins = `<ul class="insights">${insights(rounds, strategies, mistakes).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;

    // strategies compared
    const best = strategies.filter((s) => s.rounds >= 10).sort((a, b) => b.net / b.rounds - a.net / a.rounds)[0];
    const strat = `<div class="scroll"><table><thead><tr><th>Strategy</th><th>Rounds</th><th>Hands won</th><th>Net</th><th>Per round</th><th>Basic strategy accuracy</th></tr></thead><tbody>` +
      strategies.map((s) => `<tr${best && best === s ? ' class="best"' : ""}><td>${esc(s.name)}</td><td>${s.rounds}</td><td>${pct(s.won / s.hands)}</td>` +
        `<td class="${s.net < 0 ? "neg" : "pos"}">${signedMoney(s.net)}</td><td>${signedMoney(s.net / s.rounds)}</td>` +
        `<td>${s.decisions ? pct(1 - s.mistakes / s.decisions) : "–"}</td></tr>`).join("") + "</tbody></table></div>";

    // bankroll
    const bankroll = lineChart(rounds.map((r) => Number(r.bank_after)), B.START_BANK || 1000);

    // win rate by dealer up card
    const ups = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"];
    const upItems = ups.map((u) => {
      const hs = hands.filter((h) => h.round.dealer_up === u);
      const won = hs.filter((h) => h.result === "win").length;
      return { label: `Dealer ${u}`, value: hs.length ? won / hs.length : 0, empty: !hs.length, text: hs.length ? `${pct(won / hs.length)} of ${hs.length}` : "–" };
    });

    // average result by true count
    const names = ["-3 or lower", "-2", "-1", "0", "+1", "+2", "+3 or higher"];
    const buckets = names.map(() => []);
    rounds.forEach((r) => { const tc = Number(r.true_count) || 0; buckets[Math.max(0, Math.min(6, tc + 3))].push(Number(r.net) || 0); });
    const tcItems = names.map((n, i) => {
      const b = buckets[i];
      const avg = b.length ? b.reduce((a, v) => a + v, 0) / b.length : 0;
      return { label: `Count ${n}`, value: avg, empty: !b.length, text: b.length ? `${signedMoney(avg)} (${b.length})` : "–" };
    });

    // win rate by starting hand (most common first)
    const starts = {};
    rounds.forEach((r) => {
      const h = (r.hands || [])[0];
      if (!h || !r.start_hand) return;
      const s = starts[r.start_hand] || (starts[r.start_hand] = { n: 0, won: 0 });
      s.n++; if (h.result === "win") s.won++;
    });
    const startItems = Object.entries(starts).sort((a, b) => b[1].n - a[1].n).slice(0, 14)
      .map(([label, s]) => ({ label, value: s.won / s.n, text: `${pct(s.won / s.n)} of ${s.n}` }));

    // mistakes
    const mist = mistakes.length
      ? `<ol class="mistakes">${mistakes.slice(0, 8).map(([t, n]) => `<li><span>${esc(t)}</span><b>${n}x</b></li>`).join("")}</ol>`
      : '<p class="muted">No mistakes recorded against basic strategy.</p>';

    // recent
    const recent = `<div class="scroll"><table><thead><tr><th>When</th><th>Strategy</th><th>You</th><th>Dealer</th><th>Result</th><th>Net</th></tr></thead><tbody>` +
      rounds.slice(-15).reverse().map((r) => {
        const when = new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        const you = (r.hands || []).map((h) => h.cards.map(B.cardText).join(" ")).join("  /  ");
        const dealer = (r.dealer_cards || []).map(B.cardText).join(" ");
        const res = (r.hands || []).map((h) => ({ win: "Win", loss: "Loss", push: "Push" }[h.result] || h.result)).join(", ");
        const n = Number(r.net) || 0;
        return `<tr><td>${esc(when)}</td><td>${esc(r.strategy)}</td><td>${esc(you)}</td><td>${esc(dealer)}</td><td>${esc(res)}</td><td class="${n < 0 ? "neg" : n > 0 ? "pos" : ""}">${signedMoney(n)}</td></tr>`;
      }).join("") + "</tbody></table></div>";

    return section("Insights", "", ins) +
      section("Strategies compared", "Each round is tagged with the strategy you picked on the Table tab.", strat) +
      section("Bankroll by round", "Bank after each round. The dashed line is your starting $1,000.", bankroll) +
      section("Win rate by dealer up card", "Share of your hands won (pushes count as not won).", bars(upItems, { max: 1 })) +
      section("Average result by true count", "Average net per round, grouped by the Hi-Lo true count at the deal.", bars(tcItems, { signed: true })) +
      section("Win rate by starting hand", "Your first two cards, most common first.", bars(startItems, { max: 1 })) +
      section("Most common mistakes", "Decisions where you didn't follow basic strategy.", mist) +
      section("Recent hands", "", recent);
  }

  /* ---------- export ---------- */
  function exportData(rounds, fmt) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === "json") return { name: `blackjack-history-${stamp}.json`, mime: "application/json", text: JSON.stringify(rounds, null, 2) };
    const cols = ["time", "strategy", "bet_total", "net", "bank_after", "dealer_up", "dealer_cards", "true_count", "start_hand", "player_hands", "results", "decisions", "mistakes"];
    const q = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = rounds.map((r) => [
      r.created_at, r.strategy, r.bet_total, r.net, r.bank_after, r.dealer_up,
      (r.dealer_cards || []).join(" "), r.true_count, r.start_hand,
      (r.hands || []).map((h) => h.cards.join(" ")).join(" | "),
      (r.hands || []).map((h) => h.result).join(" | "),
      r.decisions, (r.mistakes || []).length
    ].map(q).join(","));
    return { name: `blackjack-history-${stamp}.csv`, mime: "text/csv", text: [cols.join(","), ...lines].join("\n") };
  }

  const api = { filterRounds, profileStats, statsHtml, exportData, money };
  root.BJ = Object.assign(root.BJ || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = Object.assign({ money, esc }, api);
})(typeof window !== "undefined" ? window : globalThis);
