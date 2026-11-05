/* Blackjack app: sign-in, table, stats and profile. */
(function () {
  "use strict";
  const B = window.BJ;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const API = "https://deckofcardsapi.com/api/deck";
  const BACK = "https://deckofcardsapi.com/static/img/back.png";
  const START_BANK = B.START_BANK;
  const MAX_HANDS = 4;
  const RESHUFFLE_BELOW = 80;                       // of 312 cards
  const ACT_BTN = { H: "hit", S: "stand", D: "double", P: "split" };
  const STRATEGIES = ["Just playing", "Basic strategy", "Basic strategy with card counting", "Mimic the dealer", "Never bust", "Martingale betting", "Gut feeling"];

  const store = B.createStore(window.BJ_CONFIG);

  const S = {
    shoe: null, remaining: 0, running: 0,
    bank: START_BANK, bet: 0, lastBet: 0,
    hands: [], active: 0, dealer: [], holeHidden: false,
    phase: "bet", busy: false,
    msg: "Place your bet.", msgClass: "",
    round: null,
    prefs: { strategy: STRATEGIES[0], hints: false, count: false }
  };
  let profile = null, rounds = [], enteredFor = null, userEmail = "", recovering = false, tab = "table";

  /* ====================================================================
     Small helpers
     ==================================================================== */
  const money = (n) => "$" + (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2));
  const signed = (n) => (n > 0 ? "+" : "") + n;
  const pts = (v) => (v === "ACE" ? 11 : ["KING", "QUEEN", "JACK"].includes(v) ? 10 : parseInt(v, 10));
  const total = (cards) => B.analyze(cards).sum;
  const isNatural = (h) => !h.split && h.cards.length === 2 && total(h.cards) === 21;
  const dealerNatural = () => S.dealer.length === 2 && total(S.dealer) === 21;

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem("bj-prefs"));
      if (p) Object.assign(S.prefs, p);
    } catch (_) {}
    if (!STRATEGIES.includes(S.prefs.strategy)) S.prefs.strategy = STRATEGIES[0];
  }
  const savePrefs = () => { try { localStorage.setItem("bj-prefs", JSON.stringify(S.prefs)); } catch (_) {} };

  function showBanner(text) {
    $("bannerText").textContent = text;
    $("banner").classList.remove("hidden");
  }
  const saveFailed = () => showBanner("Couldn't save to your account. Check your connection; your next round will try again.");

  /* ====================================================================
     Auth screens (Netlify Identity)
     ==================================================================== */
  let authMode = "login";
  function authMsg(text, kind) {
    const el = $("authMsg");
    el.textContent = text || "";
    el.className = "authmsg " + (kind || "");
  }
  function showAuth(which) {
    $("appView").classList.add("hidden");
    $("tabs").classList.add("hidden");
    $("logout").classList.add("hidden");
    $("authView").classList.remove("hidden");
    $("authCard").classList.toggle("hidden", which !== "login");
    $("forgotCard").classList.toggle("hidden", which !== "forgot");
    $("recoverCard").classList.toggle("hidden", which !== "recover");
    authMsg("");
    if (which === "login") setAuthMode(authMode);
  }
  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll("#authSeg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    $("authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
    $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
    $("forgotLink").classList.toggle("hidden", mode !== "login");
  }
  function friendlyAuthError(e) {
    const m = (e && e.message) || "Something went wrong.";
    if (/invalid login|no user found|password invalid|invalid_grant/i.test(m)) return "That email and password don't match. Check them and try again.";
    if (/already (been )?registered/i.test(m)) return "That email already has an account. Switch to Log in.";
    if (/email not confirmed/i.test(m)) return "Confirm your email first. Check your inbox for the link we sent.";
    if (/password should be|password.*(short|length)/i.test(m)) return "Use a password with at least 6 characters.";
    return m;
  }

  function bindAuth() {
    document.querySelectorAll("#authSeg button").forEach((b) => b.addEventListener("click", () => { setAuthMode(b.dataset.mode); authMsg(""); }));
    $("forgotLink").addEventListener("click", () => showAuth("forgot"));
    $("backToLogin").addEventListener("click", () => showAuth("login"));
    if (store.googleEnabled) $("googleWrap").classList.remove("hidden");

    $("authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("email").value.trim(), password = $("password").value;
      $("authSubmit").disabled = true;
      authMsg(authMode === "login" ? "Logging in…" : "Creating your account…");
      try {
        if (authMode === "login") await store.signIn(email, password);
        else {
          const r = await store.signUp(email, password);
          if (r.needsConfirmation) authMsg("Account created. Check your email for a confirmation link, then log in.", "ok");
        }
      } catch (err) { authMsg(friendlyAuthError(err), "err"); }
      $("authSubmit").disabled = false;
    });

    $("googleBtn").addEventListener("click", async () => {
      try { await store.signInWithGoogle(); } catch (err) { authMsg(friendlyAuthError(err), "err"); }
    });

    $("forgotForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await store.resetPassword($("forgotEmail").value.trim());
        authMsg("If that email has an account, a reset link is on its way.", "ok");
      } catch (err) { authMsg(friendlyAuthError(err), "err"); }
    });

    $("recoverForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await store.updatePassword($("newPassword").value);
        recovering = false;
        const s = await store.getSession();
        if (s) await enterApp(s.user); else showAuth("login");
      } catch (err) { authMsg(friendlyAuthError(err), "err"); }
    });

    $("logout").addEventListener("click", async () => {
      try { await store.signOut(); } catch (_) {}
    });
  }

  /* ====================================================================
     Entering the app
     ==================================================================== */
  async function enterApp(user) {
    if (recovering) return;
    const key = user.id || user.email;
    if (enteredFor === key) return;
    enteredFor = key;
    userEmail = user.email || "";
    try {
      profile = await store.getProfile();
      rounds = await store.getRounds();
    } catch (e) {
      enteredFor = null;
      if (store.mode === "cloud") { showAuth("login"); authMsg("Couldn't load your account data. Refresh the page and try again.", "err"); }
      return;
    }
    S.bank = Number(profile.bank);
    S.bet = 0; S.hands = []; S.dealer = []; S.phase = "bet"; S.busy = false;
    say("Place your bet.");
    $("authView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("tabs").classList.remove("hidden");
    if (store.mode === "cloud") $("logout").classList.remove("hidden");
    showBanner(store.mode === "cloud"
      ? "Welcome! Your bank is saved to your account. Good luck at the table."
      : store.notice || "Guest mode: your bank and stats are saved in this browser only.");
    showTab("table");
    render();
  }

  /* ====================================================================
     Deck of Cards API
     ==================================================================== */
  async function api(path) {
    const res = await fetch(`${API}/${path}`);
    if (!res.ok) throw new Error("Deck service returned " + res.status);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Deck service error");
    return data;
  }
  async function newShoe() {
    const d = await api("new/shuffle/?deck_count=6");
    S.shoe = d.deck_id; S.remaining = d.remaining; S.running = 0;
  }
  async function draw(n) {
    if (!S.shoe) await newShoe();
    let d;
    try { d = await api(`${S.shoe}/draw/?count=${n}`); }
    catch (_) { await newShoe(); d = await api(`${S.shoe}/draw/?count=${n}`); }
    S.remaining = d.remaining;
    return d.cards.map((c) => ({ code: c.code, img: c.image, value: c.value, suit: c.suit, pts: pts(c.value), fresh: true, counted: false }));
  }
  const preload = (cards) => cards.forEach((c) => { new Image().src = c.img; });
  function reveal(c) { if (!c.counted) { c.counted = true; S.running += B.hiLo(c); } }

  /* ====================================================================
     Rendering the table
     ==================================================================== */
  function cardEl(c, hidden) {
    const img = document.createElement("img");
    img.className = "card" + (c.fresh ? " fresh" : "");
    img.src = hidden ? BACK : c.img;
    img.alt = hidden ? "Face-down card" : `${c.value.toLowerCase()} of ${c.suit.toLowerCase()}`;
    img.draggable = false;
    return img;
  }
  function totalText(cards) {
    const a = B.analyze(cards);
    return a.soft && a.sum < 21 ? `soft ${a.sum}` : String(a.sum);
  }
  function say(msg, cls) { S.msg = msg; S.msgClass = cls || ""; }

  const canDouble = (h) => h.cards.length === 2 && S.bank >= h.bet && !h.locked;
  const canSplit = (h) =>
    h.cards.length === 2 && h.cards[0].pts === h.cards[1].pts &&
    S.hands.length < MAX_HANDS && S.bank >= h.bet &&
    !(h.split && h.cards[0].value === "ACE");
  const needsAction = (h) => !h.locked && total(h.cards) < 21;
  const recFor = (h) => B.recommend(h.cards, S.dealer[0].pts, { canDouble: canDouble(h), canSplit: canSplit(h) });
  const turnMessage = () => (S.hands.length > 1 ? `Hand ${S.active + 1} of ${S.hands.length}: hit, stand, double, or split.` : "Your move.");

  function render() {
    $("bank").textContent = money(S.bank);
    $("bet").textContent = money(S.bet);
    $("left").textContent = S.shoe ? String(S.remaining) : "–";

    $("dealer").replaceChildren(...S.dealer.map((c, i) => cardEl(c, S.holeHidden && i === 1)));
    $("dtotal").textContent = !S.dealer.length ? "" : S.holeHidden ? String(S.dealer[0].pts) : totalText(S.dealer);

    $("hands").replaceChildren(...S.hands.map((h, i) => {
      const wrap = document.createElement("div");
      wrap.className = "hand" + (S.phase === "play" && i === S.active ? " active" : "");
      const row = document.createElement("div");
      row.className = "cards";
      h.cards.forEach((c) => row.appendChild(cardEl(c, false)));
      const cap = document.createElement("div");
      cap.className = "caption";
      const t = document.createElement("span"); t.className = "total"; t.textContent = totalText(h.cards);
      const b = document.createElement("span"); b.textContent = "Bet " + money(h.bet);
      cap.append(t, b);
      if (h.result) { const r = document.createElement("span"); r.className = "result " + h.resultClass; r.textContent = h.result; cap.appendChild(r); }
      wrap.append(row, cap);
      return wrap;
    }));
    S.dealer.forEach((c) => (c.fresh = false));
    S.hands.forEach((h) => h.cards.forEach((c) => (c.fresh = false)));

    $("status").textContent = S.msg;
    $("status").className = S.msgClass;

    const betting = S.phase === "bet";
    $("betPanel").classList.toggle("hidden", !betting);
    $("playPanel").classList.toggle("hidden", betting);

    if (betting) {
      const free = S.bank - S.bet;
      document.querySelectorAll(".chip").forEach((b) => (b.disabled = S.busy || +b.dataset.v > free));
      $("clear").disabled = S.busy || S.bet === 0;
      $("deal").disabled = S.busy || S.bet === 0;
      const broke = S.bank < 5 && S.bet === 0;
      ["deal", "clear", "rebet"].forEach((id) => $(id).classList.toggle("hidden", broke));
      $("reset").classList.toggle("hidden", !broke);
      $("rebet").disabled = S.busy || S.lastBet === 0 || S.bank < 5;
    } else {
      const h = S.hands[S.active];
      const myTurn = S.phase === "play" && !S.busy && h;
      $("hit").disabled = !myTurn;
      $("stand").disabled = !myTurn;
      $("double").disabled = !(myTurn && canDouble(h));
      $("split").disabled = !(myTurn && canSplit(h));
    }
    $("resetBank").disabled = S.busy || S.phase !== "bet";

    // hints and count
    const h = S.hands[S.active];
    const rec = S.phase === "play" && !S.busy && h && S.dealer.length ? recFor(h) : null;
    $("hintLine").textContent = S.prefs.hints && rec ? `Basic strategy says: ${B.ACTION_NAME[rec]}` : "";
    Object.keys(ACT_BTN).forEach((k) => $(ACT_BTN[k]).classList.toggle("hint", !!(S.prefs.hints && rec === k)));
    $("countLine").textContent = S.prefs.count
      ? `Running count ${signed(S.running)}, true count ${signed(B.trueCount(S.running, S.remaining || 312))}`
      : "";
  }

  /* ====================================================================
     Round flow
     ==================================================================== */
  async function deal() {
    if (S.busy || S.phase !== "bet" || S.bet <= 0 || S.bet > S.bank) return;
    S.busy = true; render();
    try {
      let shuffled = false;
      if (!S.shoe || S.remaining < RESHUFFLE_BELOW) { await newShoe(); shuffled = true; }
      const tc = B.trueCount(S.running, S.remaining);
      const c = await draw(4);                       // player, dealer, player, dealer
      preload(c);
      S.bank -= S.bet;
      store.saveBank(S.bank).catch(saveFailed);
      S.lastBet = S.bet;
      const hand = { cards: [c[0], c[2]], bet: S.bet, split: false, locked: false, result: "", resultClass: "", outcome: "", net: 0 };
      S.hands = [hand];
      S.dealer = [c[1], c[3]];
      S.holeHidden = true; S.active = 0; S.phase = "play"; S.bet = 0;
      reveal(c[0]); reveal(c[1]); reveal(c[2]);       // the hole card (c[3]) is counted when it is turned over
      S.round = { tc, start: B.handLabel(hand.cards), mistakes: [], decisions: 0 };
      say(shuffled ? "New shoe shuffled. Your move." : "Your move.");
      render();
      if (isNatural(hand) || dealerNatural()) { await sleep(600); await finishRound(); }
    } catch (e) {
      say("Couldn't reach the deck service. Check your connection and press Deal to try again.", "lose");
      S.phase = "bet";
    }
    S.busy = false; render();
  }

  // Capture what basic strategy says now; call the returned function once the action has actually happened.
  function decision(h) {
    const rec = recFor(h);
    const situation = `${B.situationLabel(h.cards)} vs ${B.upLabel(S.dealer[0].pts)}`;
    return (action) => {
      S.round.decisions++;
      if (rec !== action) S.round.mistakes.push({ situation, played: B.ACTION_NAME[action], correct: B.ACTION_NAME[rec] });
    };
  }

  async function hit() {
    if (S.busy || S.phase !== "play") return;
    const h = S.hands[S.active];
    const log = decision(h);
    S.busy = true; render();
    try {
      const [c] = await draw(1);
      log("H");
      h.cards.push(c); reveal(c);
      say(turnMessage()); render();
      if (total(h.cards) >= 21) { await sleep(450); await advance(); }
    } catch (e) { say("Couldn't draw a card. Press Hit to try again.", "lose"); }
    S.busy = false; render();
  }

  async function stand() {
    if (S.busy || S.phase !== "play") return;
    decision(S.hands[S.active])("S");
    S.busy = true; render();
    await advance();
    S.busy = false; render();
  }

  async function doubleDown() {
    if (S.busy || S.phase !== "play") return;
    const h = S.hands[S.active];
    if (!canDouble(h)) return;
    const log = decision(h);
    S.busy = true; render();
    try {
      const [c] = await draw(1);
      log("D");
      S.bank -= h.bet;
      h.bet *= 2;
      h.cards.push(c); reveal(c);
      render();
      await sleep(550);
      await advance();
    } catch (e) { say("Couldn't draw a card. Press Double down to try again.", "lose"); }
    S.busy = false; render();
  }

  async function split() {
    if (S.busy || S.phase !== "play") return;
    const h = S.hands[S.active];
    if (!canSplit(h)) return;
    const log = decision(h);
    S.busy = true; render();
    try {
      const [n1, n2] = await draw(2);
      log("P");
      S.bank -= h.bet;
      reveal(n1); reveal(n2);
      const aces = h.cards[0].value === "ACE";
      const mk = (a, b) => ({ cards: [a, b], bet: h.bet, split: true, locked: aces, result: "", resultClass: "", outcome: "", net: 0 });
      S.hands.splice(S.active, 1, mk(h.cards[0], n1), mk(h.cards[1], n2));
      say(turnMessage()); render();
      if (!needsAction(S.hands[S.active])) { await sleep(500); await advance(); }
    } catch (e) { say("Couldn't draw cards. Press Split to try again.", "lose"); }
    S.busy = false; render();
  }

  async function advance() {
    S.active++;
    while (S.active < S.hands.length && !needsAction(S.hands[S.active])) S.active++;
    if (S.active >= S.hands.length) { S.active = S.hands.length - 1; await finishRound(); }
    else { say(turnMessage()); render(); }
  }

  async function finishRound() {
    S.phase = "dealer";
    S.holeHidden = false;
    reveal(S.dealer[1]);
    say("Dealer's turn.");
    render();
    await sleep(600);

    const live = S.hands.some((h) => total(h.cards) <= 21 && !isNatural(h));
    if (live && !dealerNatural()) {
      try {
        while (total(S.dealer) < 17) {
          const [c] = await draw(1);
          S.dealer.push(c); reveal(c);
          render();
          await sleep(650);
        }
      } catch (e) {
        S.hands.forEach((h) => (S.bank += h.bet));
        store.saveBank(S.bank).catch(saveFailed);
        S.hands = []; S.dealer = []; S.phase = "bet";
        say("Lost connection while the dealer was drawing. Your bets for this round were returned.", "lose");
        render();
        return;
      }
    }
    settle();
  }

  function settle() {
    const dt = total(S.dealer);
    const dNat = dealerNatural();
    let net = 0, betTotal = 0;

    S.hands.forEach((h) => {
      const pt = total(h.cards);
      let payout = 0, text, cls, outcome;
      if (pt > 21) { text = "Bust"; cls = "lose"; outcome = "loss"; }
      else if (isNatural(h)) {
        if (dNat) { payout = h.bet; text = "Push"; cls = ""; outcome = "push"; }
        else { payout = h.bet * 2.5; text = "Blackjack"; cls = "win"; outcome = "win"; }
      }
      else if (dNat) { text = "Dealer blackjack"; cls = "lose"; outcome = "loss"; }
      else if (dt > 21 || pt > dt) { payout = h.bet * 2; text = "Win"; cls = "win"; outcome = "win"; }
      else if (pt === dt) { payout = h.bet; text = "Push"; cls = ""; outcome = "push"; }
      else { text = "Lose"; cls = "lose"; outcome = "loss"; }

      h.result = text; h.resultClass = cls; h.outcome = outcome; h.net = payout - h.bet;
      S.bank += payout;
      net += payout - h.bet;
      betTotal += h.bet;
    });

    const one = S.hands.length === 1 ? S.hands[0] : null;
    if (net > 0) say(one && one.result === "Blackjack" ? `Blackjack! You win ${money(net)}.` : `You win ${money(net)}.`, "win");
    else if (net < 0) say(one && one.result === "Bust" ? `Bust. You lose ${money(-net)}.` : `You lose ${money(-net)}.`, "lose");
    else say("Push. Your bet is returned.");

    const round = {
      created_at: new Date().toISOString(),
      strategy: S.prefs.strategy,
      bet_total: betTotal,
      net,
      bank_after: S.bank,
      dealer_up: B.upLabel(S.dealer[0].pts),
      dealer_cards: S.dealer.map((c) => c.code),
      true_count: S.round.tc,
      start_hand: S.round.start,
      hands: S.hands.map((h) => ({ cards: h.cards.map((c) => c.code), bet: h.bet, result: h.outcome, net: h.net, blackjack: isNatural(h) })),
      mistakes: S.round.mistakes,
      decisions: S.round.decisions,
      blackjack: S.hands.some(isNatural)
    };
    rounds.push(round);
    store.addRound(round).catch(saveFailed);
    store.saveBank(S.bank).catch(saveFailed);

    S.phase = "bet";
    render();
  }

  /* ====================================================================
     Tabs: stats and profile
     ==================================================================== */
  function showTab(name) {
    tab = name;
    document.querySelectorAll("#tabs button").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on);
    });
    ["table", "stats", "profile"].forEach((t) => $(t + "View").classList.toggle("hidden", t !== name));
    if (name === "stats") renderStats();
    if (name === "profile") renderProfile();
  }

  function filteredRounds() {
    return B.filterRounds(rounds, { strategy: $("fStrategy").value, range: $("fRange").value });
  }
  function renderStats() { $("statsBody").innerHTML = B.statsHtml(filteredRounds()); }

  function download(file) {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
    const a = document.createElement("a");
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderProfile() {
    const cloud = store.mode === "cloud";
    $("signedIn").textContent = cloud ? `Signed in as ${userEmail || "your account"}` : "Playing as a guest on this device";
    $("profileWelcome").classList.toggle("hidden", !!profile.username);
    $("pDisplay").value = profile.display_name || "";
    $("pUser").value = profile.username || "";
    $("pTown").value = profile.hometown || "";
    $("pBio").value = profile.bio || "";
    $("bioCount").textContent = `${$("pBio").value.length}/280`;

    const st = B.profileStats(rounds);
    const tiles = [
      ["Bank", money(S.bank)],
      ["Hands played", st.hands.toLocaleString()],
      ["Win rate", st.hands ? Math.round(st.winRate * 100) + "%" : "–"],
      ["Won / Lost / Push", `${st.won} / ${st.lost} / ${st.push}`],
      ["Blackjacks", String(st.blackjacks)],
      ["Biggest win", money(st.biggestWin)],
      ["Member since", profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "–"]
    ];
    $("pStats").replaceChildren(...tiles.map(([k, v]) => {
      const d = document.createElement("div"); d.className = "tile";
      const a = document.createElement("span"); a.textContent = k;
      const b = document.createElement("strong"); b.textContent = v;
      d.append(a, b); return d;
    }));
  }

  async function saveProfile(e) {
    e.preventDefault();
    const msg = $("profileMsg");
    const fields = {
      display_name: $("pDisplay").value.trim(),
      username: $("pUser").value.trim(),
      hometown: $("pTown").value.trim(),
      bio: $("pBio").value.trim().slice(0, 280)
    };
    if (!/^[A-Za-z0-9_]{3,20}$/.test(fields.username)) {
      msg.textContent = "Username must be 3–20 letters, numbers, or underscores.";
      msg.className = "authmsg err"; return;
    }
    try {
      await store.saveProfile(fields);
      Object.assign(profile, fields);
      msg.textContent = "Profile saved."; msg.className = "authmsg ok";
      $("profileWelcome").classList.add("hidden");
    } catch (err) {
      msg.textContent = err.code === "username_taken" ? "That username is taken. Try another." : "Couldn't save your profile. Try again.";
      msg.className = "authmsg err";
    }
  }

  /* ====================================================================
     Event wiring
     ==================================================================== */
  function bindUI() {
    // strategy options
    $("strategy").replaceChildren(...STRATEGIES.map((s) => new Option(s, s)));
    $("fStrategy").replaceChildren(new Option("All strategies", "all"), ...STRATEGIES.map((s) => new Option(s, s)));
    $("strategy").value = S.prefs.strategy;
    $("hints").checked = S.prefs.hints;
    $("count").checked = S.prefs.count;
    $("strategy").addEventListener("change", (e) => { S.prefs.strategy = e.target.value; savePrefs(); });
    $("hints").addEventListener("change", (e) => { S.prefs.hints = e.target.checked; savePrefs(); render(); });
    $("count").addEventListener("change", (e) => { S.prefs.count = e.target.checked; savePrefs(); render(); });

    document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    $("bannerClose").addEventListener("click", () => $("banner").classList.add("hidden"));

    document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
      const v = +b.dataset.v;
      if (S.busy || S.phase !== "bet" || S.bet + v > S.bank) return;
      S.bet += v; render();
    }));
    $("clear").addEventListener("click", () => { S.bet = 0; render(); });
    $("rebet").addEventListener("click", () => { if (!S.busy && S.phase === "bet") { S.bet = Math.min(S.lastBet, S.bank); render(); } });
    $("deal").addEventListener("click", deal);
    const resetBank = () => {
      if (S.busy || S.phase !== "bet") return;
      S.bank = START_BANK; S.bet = 0; S.lastBet = 0;
      store.saveBank(S.bank).catch(saveFailed);
      say("Bank reset to $1,000. Place your bet.");
      render();
    };
    $("reset").addEventListener("click", resetBank);
    $("resetBank").addEventListener("click", resetBank);

    $("hit").addEventListener("click", hit);
    $("stand").addEventListener("click", stand);
    $("double").addEventListener("click", doubleDown);
    $("split").addEventListener("click", split);

    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || tab !== "table") return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (S.phase === "play") {
        if (k === "h") hit(); else if (k === "s") stand(); else if (k === "d") doubleDown(); else if (k === "p") split();
      } else if (S.phase === "bet" && k === "enter" && tag !== "BUTTON") deal();
    });

    $("fStrategy").addEventListener("change", renderStats);
    $("fRange").addEventListener("change", renderStats);
    $("exportCsv").addEventListener("click", () => download(B.exportData(filteredRounds(), "csv")));
    $("exportJson").addEventListener("click", () => download(B.exportData(filteredRounds(), "json")));

    $("profileForm").addEventListener("submit", saveProfile);
    $("pBio").addEventListener("input", () => { $("bioCount").textContent = `${$("pBio").value.length}/280`; });
  }

  /* ====================================================================
     Boot
     ==================================================================== */
  async function boot() {
    loadPrefs();
    bindUI();
    if (store.mode === "local") {
      await enterApp({ email: "guest" });
      return;
    }
    bindAuth();
    store.onAuth((event, session) => {
      if (event === "PASSWORD_RECOVERY") { recovering = true; setTimeout(() => showAuth("recover"), 0); return; }
      if (event === "SIGNED_OUT") { enteredFor = null; setTimeout(() => showAuth("login"), 0); return; }
      if (session && !recovering) setTimeout(() => enterApp(session.user), 0);
    });
    const s = await store.getSession();
    if (s && !recovering) await enterApp(s.user);
    else if (!s && !recovering) showAuth("login");
  }
  boot();
})();
