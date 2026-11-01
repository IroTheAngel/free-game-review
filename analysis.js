"use strict";
/* Move ratings, accuracy and the coach's explanations.
   Everything works from "win chance" (0-100 for the player to move), worked out from the engine score
   the same way Lichess does; a move's rating is how much win chance it gave away. */

const RT = {
  brilliant: { g: "!!", l: "Brilliant" },
  great: { g: "!", l: "Great" },
  best: { g: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>', l: "Best" },
  excellent: { g: '<svg viewBox="0 0 24 24"><path d="M2 21h3.5V9.5H2zM22 10.5c0-1.1-.9-2-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1.5 6.8 7.9c-.4.4-.6.9-.6 1.4V19c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.1-.5.1-.7z"/></svg>', l: "Excellent" },
  good: { g: '<svg viewBox="0 0 24 24"><path d="M9.5 16.6 4.9 12l-1.8 1.8 6.4 6.4L21 8.7l-1.8-1.8z"/></svg>', l: "Good" },
  book: { g: '<svg viewBox="0 0 24 24"><path d="M6 2.5h12a1 1 0 0 1 1 1v15H7.5a1.5 1.5 0 0 0 0 3H19v1H7.5A2.5 2.5 0 0 1 5 20V3.5a1 1 0 0 1 1-1z"/></svg>', l: "Book" },
  inaccuracy: { g: "?!", l: "Inaccuracy" },
  mistake: { g: "?", l: "Mistake" },
  miss: { g: '<svg viewBox="0 0 24 24"><path d="M18.3 4.3 12 10.6 5.7 4.3 4.3 5.7 10.6 12l-6.3 6.3 1.4 1.4 6.3-6.3 6.3 6.3 1.4-1.4-6.3-6.3 6.3-6.3z"/></svg>', l: "Miss" },
  blunder: { g: "??", l: "Blunder" }
};
const RT_ORDER = ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "miss", "blunder"];
// Optional picture badges: PNGs named <rating>.png in img/moves/ (for private use, from chess.com's brand resources).
// When all of them load they replace the drawn badges; otherwise the drawn ones stay.
let MOVE_ICONS = false;
const badgeInner = k => MOVE_ICONS ? `<img src="img/moves/${k}.png" alt="">` : RT[k].g;
function loadMoveIcons(done) {
  let left = RT_ORDER.length, ok = true;
  for (const k of RT_ORDER) {
    const im = new Image();
    im.onload = () => { if (--left === 0 && ok) { MOVE_ICONS = true; document.documentElement.classList.add("pic-badges"); done(); } };
    im.onerror = () => { ok = false; --left; };
    im.src = `img/moves/${k}.png`;
  }
}
const BAD = new Set(["inaccuracy", "mistake", "miss", "blunder"]);
const NOTABLE = new Set(["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"]);
const article = k => /^[aeiou]/i.test(RT[k].l) ? "an" : "a";

/* ---------- win chance ---------- */
// ev = {cp, mate} from the side to move. mate 0 = the side to move is checkmated.
function winPct(ev) {
  if (!ev) return 50;
  if (ev.mate !== null && ev.mate !== undefined) return ev.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, ev.cp || 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
// a score as White sees it, as text: +1.3, -0.4, M3, -M2
function evalText(ev, turn) {
  if (!ev) return "";
  const s = turn === "w" ? 1 : -1;
  if (ev.mate !== null && ev.mate !== undefined) {
    if (ev.mate === 0) return turn === "w" ? "0-1" : "1-0";
    const m = ev.mate * s;
    return (m > 0 ? "M" : "-M") + Math.abs(ev.mate);
  }
  const v = (ev.cp * s) / 100;
  return (v > 0 ? "+" : "") + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
}
const whiteWin = (ev, turn) => turn === "w" ? winPct(ev) : 100 - winPct(ev);

/* ---------- material helpers (ported from the Repertoire Trainer) ---------- */
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }, PNAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
function material(c) { let s = 0; c.board().forEach(row => row.forEach(p => { if (p) s += (p.color === "w" ? 1 : -1) * VAL[p.type]; })); return s; }
function qs(c, alpha, beta, depth) {
  const stand = (c.turn() === "w" ? 1 : -1) * material(c);
  if (depth === 0 || stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const caps = c.moves({ verbose: true }).filter(m => m.captured || m.promotion)
    .sort((a, b) => (VAL[b.captured || "p"] - VAL[b.piece] / 10) - (VAL[a.captured || "p"] - VAL[a.piece] / 10));
  for (const m of caps) { c.move(m); const s = -qs(c, -beta, -alpha, depth - 1); c.undo(); if (s >= beta) return s; if (s > alpha) alpha = s; }
  return alpha;
}
// material for the mover after a move, once the other side has made its best captures
function valueAfter(fen, mv) { const c = new Chess(fen); if (!c.move(mv)) return null; return -qs(c, -99, 99, 7); }
const amount = v => v >= 8 ? "the queen" : v >= 4.5 ? "a rook" : v >= 2.5 ? "a piece" : v >= 1.5 ? "the exchange" : "a pawn";
// pieces (knight or bigger) the opponent could take right now if it were their turn
function exposed(c) {
  const f = c.fen().split(" "); f[1] = f[1] === "w" ? "b" : "w"; f[3] = "-";
  const d = new Chess(); if (!d.load(f.join(" "))) return null;
  return new Set(d.moves({ verbose: true }).filter(r => r.captured && VAL[r.captured] >= 3).map(r => r.to));
}
// a real sacrifice: the moved piece (or a piece it uncovers) can be taken, and grabbing it wins at least 2 points
function sacrificeFen(fen, mv) {
  const c = new Chess(fen);
  const me = c.turn() === "w" ? 1 : -1, before = me * material(c), pre = exposed(c), m = c.move(mv);
  if (!m || !pre) return false;
  const caps = c.moves({ verbose: true }).filter(r => r.captured);
  if (!caps.some(r => r.to === m.to || (VAL[r.captured] >= 3 && !pre.has(r.to)))) return false;
  return -qs(c, -99, 99, 7) <= before - 2;
}
const uciOf = m => m.from + m.to + (m.promotion || "");
function uciToMove(fen, u) { if (!u || u.length < 4) return null; const c = new Chess(fen); return c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); }
function pvSan(fen, pv, max = 8) {
  const c = new Chess(fen), out = [];
  for (const u of (pv || []).slice(0, max)) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); if (!m) break; out.push(m.san); }
  return out;
}

/* ---------- ratings ---------- */
// G: {fens, moves (chess.js verbose), E (engine result per position), book (bool per move)}
// E[i] = {cp, mate, best, pv, second:{cp,mate,uci}|null}, scores from the side to move at position i
function rateMove(G, i, prev) {
  const e0 = G.E[i], e1 = G.E[i + 1];
  if (!e0 || !e1) return null;
  const m = G.moves[i], uci = uciOf(m), fen = G.fens[i];
  const wpB = winPct(e0), wpA = 100 - winPct(e1), loss = Math.max(0, wpB - wpA);
  const r = { wpB, wpA, loss, uci, cls: null };
  if (G.book[i]) { r.cls = "book"; return r; }
  const sec = e0.second;
  let isBest = uci === e0.best;
  if (!isBest && sec && uci === sec.uci && Math.abs(winPct(sec) - wpB) < 1) isBest = true; // just as good as the top move
  if (!isBest && loss < 0.3) isBest = true;
  let cls = isBest ? "best" : loss <= 2 ? "excellent" : loss <= 5 ? "good" : loss <= 10 ? "inaccuracy" : loss <= 20 ? "mistake" : "blunder";
  const pr = prev && prev.cls ? prev : null;
  if ((isBest || loss <= 2) && wpB < 97 && wpA >= 45 && sacrificeFen(fen, m.san)) cls = "brilliant";
  else if (isBest && sec) {
    // the only good move: everything else is much worse (simple recaptures and forced moves don't count)
    const p = G.moves[i - 1], recapture = p && p.captured && m.to === p.to && m.captured;
    const gap = wpB - winPct(sec);
    if (!recapture && wpB < 97 && wpB > 5 && (gap >= 15 || (gap >= 8 && pr && (pr.cls === "blunder" || pr.cls === "mistake")))) cls = "great";
  }
  // a miss: the opponent just made a mistake and this move lets the chance go
  if (BAD.has(cls) && i > 0 && G.E[i - 1]) {
    const myPrev = 100 - winPct(G.E[i - 1]); // my win chance before the opponent's move
    if (wpB - myPrev >= 10 && wpA >= myPrev - 5) cls = "miss";
  }
  // a missed checkmate while still doing fine (e1.mate <= 0: the opponent is mated or still getting mated)
  const stillMating = e1.mate !== null && e1.mate !== undefined && e1.mate <= 0;
  if (e0.mate > 0 && e0.mate <= 3 && !stillMating && wpA >= 50 && cls !== "brilliant") cls = "miss";
  r.cls = cls;
  return r;
}

/* ---------- accuracy (Lichess's method) ---------- */
function moveAccuracy(before, after) {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}
function stdev(xs) { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); }
function gameAccuracy(G) {
  const n = G.moves.length; if (!n || G.E.some(e => !e)) return null;
  const wps = G.E.map((e, i) => whiteWin(e, G.fens[i].split(" ")[1]));
  const ws = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows = [];
  for (let k = 0; k < Math.min(ws, wps.length) - 2; k++) windows.push(wps.slice(0, ws));
  for (let k = 0; k + ws <= wps.length; k++) windows.push(wps.slice(k, k + ws));
  const weights = windows.map(xs => Math.max(0.5, Math.min(12, stdev(xs))));
  const acc = { w: [], b: [] };
  for (let i = 0; i < n; i++) {
    const col = G.moves[i].color, p = wps[i], q = wps[i + 1];
    const a = col === "w" ? moveAccuracy(p, q) : moveAccuracy(100 - p, 100 - q);
    acc[col].push([a, weights[Math.min(i, weights.length - 1)]]);
  }
  const one = xs => {
    if (!xs.length) return null;
    const sw = xs.reduce((s, x) => s + x[1], 0), wm = xs.reduce((s, x) => s + x[0] * x[1], 0) / sw;
    const hm = xs.length / xs.reduce((s, x) => s + 1 / Math.max(x[0], 0.5), 0);
    return (wm + hm) / 2;
  };
  return { w: one(acc.w), b: one(acc.b) };
}

/* ---------- the coach ---------- */
const SAN = s => `<b class="san">${esc(s)}</b>`;
// who: {name(color) -> "You"/"White"..., poss(color) -> "your"/"White's"}
function coachText(G, i, R, who) {
  const r = R[i], m = G.moves[i], fen = G.fens[i], e0 = G.E[i], e1 = G.E[i + 1];
  if (!r || !e0 || !e1) return { head: "", body: "" };
  const me = m.color, opp = me === "w" ? "b" : "w";
  const k = r.cls, label = RT[k].l.toLowerCase();
  const bestMv = uciToMove(fen, e0.best), bestSan = bestMv ? bestMv.san : null;
  const head = k === "best" ? `${SAN(m.san)} is best` : k === "book" ? `${SAN(m.san)} is a book move` : `${SAN(m.san)} is ${article(k)} ${label}` + (k === "brilliant" ? "!" : "");
  const out = [];
  const mateNow = e1.mate !== null && e1.mate !== undefined && e1.mate > 0; // the opponent has a forced mate
  if (k === "book") {
    const nm = G.openingAt[i + 1];
    out.push(nm ? `This is known opening theory: ${esc(nm)}.` : "This is known opening theory.");
  } else if (k === "brilliant") {
    out.push(`A sacrifice that works! ${SAN(m.san)} offers material, but taking it doesn't work out for ${who.name(opp, true)}.`);
  } else if (k === "great") {
    const pr = R[i - 1];
    out.push(pr && (pr.cls === "blunder" || pr.cls === "mistake") ? `${who.name(me)} found the right way to punish the mistake.` : `The only good move here. Everything else gives away much of the advantage.`);
  } else if (k === "best") {
    out.push(/#/.test(m.san) ? "Checkmate!" : e0.mate > 0 ? "Keeps the forced checkmate going." : "The engine's top choice.");
  } else if (k === "excellent") {
    out.push(`Almost as strong as the best move${bestSan ? `, ${SAN(bestSan)}` : ""}.`);
  } else if (k === "good") {
    out.push(`A decent move, but ${bestSan ? SAN(bestSan) : "another move"} was a little stronger.`);
  } else {
    // why it's bad, from simplest to most general
    let why = null;
    if (mateNow) {
      const reply = uciToMove(G.fens[i + 1], e1.best);
      why = e1.mate === 1 && reply ? `This allows checkmate: ${who.name(opp)} can play ${SAN(reply.san)}.` : `This allows a forced checkmate in ${e1.mate}.`;
    } else if (e0.mate > 0) {
      why = `${who.name(me)} had a forced checkmate in ${e0.mate}${bestSan ? `, starting with ${SAN(bestSan)}` : ""}.`;
    } else {
      const vMine = valueAfter(fen, m.san), vBest = bestSan ? valueAfter(fen, bestSan) : null;
      const c0 = new Chess(fen), before = (me === "w" ? 1 : -1) * material(c0);
      if (vMine !== null && vBest !== null && vBest - vMine >= 0.9 && before - vMine >= 0.9) {
        // it hangs material: show the capture
        const c = new Chess(fen); c.move(m.san);
        let worst = null, wv = 99;
        for (const x of c.moves({ verbose: true })) { if (!x.captured) continue; c.move(x); const v = qs(c, -99, 99, 6); c.undo(); if (v < wv) { wv = v; worst = x; } }
        const lost = before - vMine;
        why = worst ? `It loses ${amount(lost)}: ${who.name(opp)} can take with ${SAN(worst.san)}.` : `It loses ${amount(lost)}.`;
      } else if (vMine !== null && vBest !== null && vBest - vMine >= 1.5 && vBest - before >= 1.5) {
        why = `${SAN(bestSan)} would have won ${amount(vBest - before)}.`;
      } else if (k === "miss") {
        why = `${who.name(opp)} had just made a mistake, but this lets the chance slip away.`;
      } else {
        const reply = uciToMove(G.fens[i + 1], e1.best);
        why = reply ? `${who.name(opp)} gets a strong answer: ${SAN(reply.san)}.` : null;
      }
    }
    if (why) out.push(why);
    if (bestSan && !(e0.mate > 0)) out.push(`The best move was ${SAN(bestSan)}.`);
  }
  return { head, body: out.join(" ") };
}
