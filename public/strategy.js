/* Basic strategy (6 decks, dealer stands on all 17s, double after split, no surrender),
   Hi-Lo counting, and hand labels. Pure functions with no DOM access. */
(function (root) {
  "use strict";

  // Columns are the dealer upcard 2,3,4,5,6,7,8,9,10,A
  const HARD = {
    9:  "H Dh Dh Dh Dh H H H H H",
    10: "Dh Dh Dh Dh Dh Dh Dh Dh H H",
    11: "Dh Dh Dh Dh Dh Dh Dh Dh Dh H",
    12: "H H S S S H H H H H",
    13: "S S S S S H H H H H",
    14: "S S S S S H H H H H",
    15: "S S S S S H H H H H",
    16: "S S S S S H H H H H"
  };
  const SOFT = {
    13: "H H H Dh Dh H H H H H",
    14: "H H H Dh Dh H H H H H",
    15: "H H Dh Dh Dh H H H H H",
    16: "H H Dh Dh Dh H H H H H",
    17: "H Dh Dh Dh Dh H H H H H",
    18: "S Ds Ds Ds Ds S S H H H"
  };
  // Keyed by card point value (11 = aces). 5s and 10s are played as hard 10 and hard 20.
  const PAIR = {
    11: "P P P P P P P P P P",
    9:  "P P P P P S P P S S",
    8:  "P P P P P P P P P P",
    7:  "P P P P P P H H H H",
    6:  "P P P P P H H H H H",
    4:  "H H H P P H H H H H",
    3:  "P P P P P P H H H H",
    2:  "P P P P P P H H H H"
  };
  const row = (s, idx) => s.split(" ")[idx];

  const ACTION_NAME = { H: "Hit", S: "Stand", D: "Double down", P: "Split" };

  function analyze(cards) {
    let sum = cards.reduce((a, c) => a + c.pts, 0);
    let aces = cards.filter((c) => c.value === "ACE").length;
    while (sum > 21 && aces > 0) { sum -= 10; aces--; }
    return {
      sum,
      soft: aces > 0 && sum <= 21,
      pair: cards.length === 2 && cards[0].pts === cards[1].pts
    };
  }

  // Returns "H", "S", "D" or "P". opt = { canDouble, canSplit }
  function recommend(cards, up, opt) {
    const a = analyze(cards);
    const idx = up - 2;
    if (a.pair && opt.canSplit && PAIR[cards[0].pts]) {
      if (row(PAIR[cards[0].pts], idx) === "P") return "P";
    }
    let tok;
    if (a.soft) {
      if (a.sum >= 19) tok = "S";
      else if (a.sum < 13) tok = "H";
      else tok = row(SOFT[a.sum], idx);
    } else {
      if (a.sum <= 8) tok = "H";
      else if (a.sum >= 17) tok = "S";
      else tok = row(HARD[a.sum], idx);
    }
    if (tok === "Dh") return opt.canDouble ? "D" : "H";
    if (tok === "Ds") return opt.canDouble ? "D" : "S";
    return tok;
  }

  // Hi-Lo: 2-6 are +1, 7-9 are 0, tens and aces are -1
  function hiLo(card) {
    if (card.pts >= 2 && card.pts <= 6) return 1;
    if (card.pts >= 7 && card.pts <= 9) return 0;
    return -1;
  }
  function trueCount(running, cardsRemaining) {
    const decks = Math.max(cardsRemaining / 52, 0.5);
    return Math.round(running / decks);
  }

  const upLabel = (pts) => (pts === 11 ? "A" : String(pts));
  function pairLabel(pts) { return pts === 11 ? "Pair of aces" : `Pair of ${pts}s`; }
  function situationLabel(cards) {
    const a = analyze(cards);
    if (a.pair) return pairLabel(cards[0].pts);
    return `${a.soft ? "Soft" : "Hard"} ${a.sum}`;
  }
  function handLabel(cards) {
    const a = analyze(cards);
    if (cards.length === 2 && a.sum === 21) return "Blackjack";
    return situationLabel(cards);
  }

  const SUITS = { S: "\u2660", H: "\u2665", D: "\u2666", C: "\u2663" };
  function cardText(code) {
    const rank = code[0] === "0" ? "10" : code[0];
    return rank + (SUITS[code[1]] || "");
  }

  const api = { recommend, analyze, hiLo, trueCount, upLabel, situationLabel, handLabel, cardText, ACTION_NAME };
  root.BJ = Object.assign(root.BJ || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
