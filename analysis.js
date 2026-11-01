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

/* ---------- why the engine's move is stronger ---------- */
const FILE_CH = "abcdefgh";
const sqName = (f, r) => FILE_CH[f] + (r + 1);
const sqXY = s => [s.charCodeAt(0) - 97, +s[1] - 1];
// board from chess.js (row 0 = rank 8); undefined = off the board, null = empty
const boardAt = (B, f, r) => f < 0 || f > 7 || r < 0 || r > 7 ? undefined : B[7 - r][f];
const LINES = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
LINES.q = LINES.b.concat(LINES.r);
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const matFor = (c, col) => (col === "w" ? 1 : -1) * material(c);
const asMove = u => typeof u === "string" && /^[a-h][1-8][a-h][1-8]/.test(u) ? { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" } : u;
// the squares a piece attacks
function attacksFrom(B, f, r) {
  const p = boardAt(B, f, r), out = [];
  if (!p) return out;
  const add = (x, y) => { if (boardAt(B, x, y) !== undefined) out.push([x, y]); };
  if (p.type === "p") { const d = p.color === "w" ? 1 : -1; add(f - 1, r + d); add(f + 1, r + d); }
  else if (p.type === "n") KNIGHT.forEach(([a, b]) => add(f + a, r + b));
  else if (p.type === "k") LINES.q.forEach(([a, b]) => add(f + a, r + b));
  else for (const [a, b] of LINES[p.type])
    for (let x = f + a, y = r + b; boardAt(B, x, y) !== undefined; x += a, y += b) { out.push([x, y]); if (boardAt(B, x, y)) break; }
  return out;
}
function guarded(B, f, r, color) {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const p = boardAt(B, x, y);
    if (p && p.color === color && attacksFrom(B, x, y).some(([a, b]) => a === f && b === r)) return true;
  }
  return false;
}
// what a move does, as short phrases ("develops the knight"), most important first
function moveIdeas(fen, mv) {
  const c = new Chess(fen), me = c.turn(), opp = me === "w" ? "b" : "w", moveNo = +fen.split(" ")[5] || 1;
  const before = matFor(c, me), m = c.move(asMove(mv));
  if (!m) return [];
  const B = c.board(), [f, r] = sqXY(m.to), P = boardAt(B, f, r), out = [];
  const name = ([x, y]) => boardAt(B, x, y).type === "k" ? "the king" : `the ${PNAME[boardAt(B, x, y).type]} on ${sqName(x, y)}`;
  // pieces it now attacks that matter: the king, something worth more, or something unprotected
  const targets = attacksFrom(B, f, r).filter(([x, y]) => {
    const q = boardAt(B, x, y);
    return q && q.color === opp && (q.type === "k" || (VAL[q.type] >= 3 && (VAL[q.type] > VAL[P.type] || !guarded(B, x, y, opp))));
  }).sort(([a, b], [x, y]) => (boardAt(B, x, y).type === "k" ? 99 : VAL[boardAt(B, x, y).type]) - (boardAt(B, a, b).type === "k" ? 99 : VAL[boardAt(B, a, b).type]));
  // a pin: it lines up on a piece with the king or something bigger behind it
  const pins = [];
  if ("brq".includes(P.type)) for (const [a, b] of LINES[P.type]) {
    let first = null;
    for (let x = f + a, y = r + b; boardAt(B, x, y) !== undefined; x += a, y += b) {
      const q = boardAt(B, x, y); if (!q) continue;
      if (q.color === me) break;
      if (!first) { if (q.type === "k" || q.type === "p") break; first = [x, y]; continue; }
      if (q.type === "k" || VAL[q.type] > VAL[boardAt(B, ...first).type]) pins.push({ sq: first, t: `pins ${name(first)} to the ${PNAME[q.type]}` });
      break;
    }
  }
  const kept = -qs(c, -99, 99, 7) - before; // material it nets once the other side's captures are done
  if (m.promotion) out.push({ k: "promote", t: `promotes to a ${PNAME[m.promotion]}` });
  if (m.captured && kept >= 0.9) out.push({ k: "grab", t: `takes the ${PNAME[m.captured]} on ${m.to}` });
  if (targets.length >= 2) out.push({ k: "fork", t: `attacks ${name(targets[0])} and ${name(targets[1])} at once` });
  if (pins.length) out.push({ k: "pin", t: pins[0].t });
  // a threat: a capture that would win material if it were the mover's turn again (and wasn't there already)
  let threat = null;
  if (!c.in_check()) {
    const t = c.fen().split(" "); t[1] = me; t[3] = "-";
    const d = new Chess();
    if (d.load(t.join(" "))) {
      const already = new Set(grabs(new Chess(fen)).map(x => x.mv.to)); // things it could already win before this move
      const g = grabs(d, true).find(x => !already.has(x.mv.to));
      if (g) { threat = g; out.push({ k: "threat", t: `threatens ${g.mv.san}, winning ${amount(g.gain)}` }); }
    }
  }
  const tq = targets[0];
  if (targets.length === 1 && boardAt(B, ...tq).type !== "k" && !pins.some(p => p.sq[0] === tq[0] && p.sq[1] === tq[1]) && !(threat && threat.mv.to === sqName(...tq)))
    out.push({ k: "attack", t: `attacks ${name(tq)}` });
  if (m.flags.includes("k") || m.flags.includes("q")) out.push({ k: "castle", t: "castles, so the king is safe and the rook can join the game" });
  if (m.piece === "p" && !m.promotion) {
    const dir = me === "w" ? 1 : -1, rel = me === "w" ? r : 7 - r;
    let free = true;
    for (let y = r + dir; y >= 0 && y <= 7; y += dir) for (const x of [f - 1, f, f + 1]) { const q = boardAt(B, x, y); if (q && q.type === "p" && q.color === opp) free = false; }
    if (free && rel >= 4) out.push({ k: "passer", t: "pushes the passed pawn closer to promoting" });
    else if (["d4", "e4", "d5", "e5"].includes(m.to) && moveNo <= 20) out.push({ k: "centre", t: "takes space in the centre" });
  }
  const home = me === "w" ? { n: ["b1", "g1"], b: ["c1", "f1"] } : { n: ["b8", "g8"], b: ["c8", "f8"] };
  if (moveNo <= 15 && home[m.piece] && home[m.piece].includes(m.from)) out.push({ k: "develop", t: `develops the ${PNAME[m.piece]}` });
  if (m.piece === "r" && m.from[0] !== m.to[0]) {
    let mine = 0, theirs = 0;
    for (let y = 0; y < 8; y++) { const q = boardAt(B, f, y); if (q && q.type === "p") q.color === me ? mine++ : theirs++; }
    if (!mine) out.push({ k: "file", t: `puts the rook on the ${theirs ? "half-open" : "open"} ${FILE_CH[f]}-file` });
  }
  if (m.captured && m.captured !== "p" && before >= 2 && Math.abs(kept) < 0.5)
    out.push({ k: "trade", t: "trades pieces while ahead in material, which makes winning easier" });
  if (m.san.includes("+") && !out.length) out.push({ k: "check", t: "gives check" });
  return out;
}
// captures that win material for the side to move once the exchanges are over (about a pawn or more), best first.
// simple: only clear-cut grabs (the target is unprotected or worth more than the piece taking it); longer
// capture chains can look good to this quick count and still fail to a quiet answer.
function grabs(c, simple) {
  const stand = matFor(c, c.turn()), B = simple ? c.board() : null, them = c.turn() === "w" ? "b" : "w", out = [];
  for (const x of c.moves({ verbose: true })) {
    if (!x.captured) continue;
    if (simple && VAL[x.captured] <= VAL[x.piece] && guarded(B, ...sqXY(x.to), them)) continue;
    c.move(x); const g = -qs(c, -99, 99, 6) - stand; c.undo();
    if (g >= 0.9) out.push({ mv: x, gain: g });
  }
  return out.sort((a, b) => b.gain - a.gain);
}
// material won or lost by `col` along a line of moves. Counted both as it stands at the end of the line and
// after the captures still left there, and the less exciting of the two is kept: captures alone can miss a
// quiet comeback (like Qd4 hitting back after Bxc6 dxc6 Nxe5), and the bare count can miss a recapture.
function lineGain(fen, ucis, col, maxPlies) {
  const c = new Chess(fen), start = matFor(c, col), played = [];
  for (const u of ucis.slice(0, maxPlies)) { const m = c.move(asMove(u)); if (!m) break; played.push(m); }
  const raw = matFor(c, col) - start, settled = (c.turn() === col ? 1 : -1) * qs(c, -99, 99, 6) - start;
  return { gain: Math.min(raw, settled), loss: Math.max(raw, settled), played };
}
// the line up to its last capture, as text (empty when that's just the first move)
function lineTo(played) {
  let last = -1;
  played.forEach((m, k) => { if (m.captured || m.promotion) last = k; });
  return last >= 1 ? `: ${SAN(played.slice(0, last + 1).map(m => m.san).join(" "))}` : "";
}
// a pawn in front of the castled king moved forward
function weakensKing(fen, mv) {
  const c = new Chess(fen), me = c.turn(), m = c.move(asMove(mv));
  if (!m || m.piece !== "p" || +m.from[1] !== (me === "w" ? 2 : 7)) return false;
  const B = c.board(), ff = m.from.charCodeAt(0) - 97;
  let kf = -1;
  for (let x = 0; x < 8; x++) { const p = boardAt(B, x, me === "w" ? 0 : 7); if (p && p.type === "k" && p.color === me) kf = x; }
  return kf >= 0 && ((kf >= 5 && ff >= 5) || (kf <= 2 && ff <= 2));
}
// how many moves the mover's pieces have after a move (a rough measure of activity)
function mobility(fen, mv) {
  const c = new Chess(fen); if (!c.move(asMove(mv)) || c.in_check()) return null;
  const f = c.fen().split(" "); f[1] = f[1] === "w" ? "b" : "w"; f[3] = "-";
  const d = new Chess(); return d.load(f.join(" ")) ? d.moves().length : null;
}
// one or two sentences on why the engine's move beats the move played
function whyStronger(G, i, who) {
  const fen = G.fens[i], e0 = G.E[i], e1 = G.E[i + 1], M = G.moves[i];
  const me = M.color, opp = me === "w" ? "b" : "w", Bm = uciToMove(fen, e0.best);
  if (!Bm) return "";
  // 1. checkmates (e0: from the mover's side; e1: from the opponent's side, after the move played)
  const mate = ev => ev.mate !== null && ev.mate !== undefined ? ev.mate : null, m0 = mate(e0), m1 = mate(e1);
  if (m0 !== null && m0 > 0) return m1 !== null && m1 < 0 ? `It checkmates faster: in ${m0} instead of ${-m1}.` : `It leads to a forced checkmate in ${m0}.`;
  if (m1 !== null && m1 > 0) return m0 !== null && m0 < 0 ? `It holds out longer: after ${SAN(M.san)}, ${who.name(opp, true)} has a forced checkmate in ${m1} instead of ${-m0}.` : `After ${SAN(M.san)}, ${who.name(opp, true)} has a forced checkmate in ${m1}.`;
  if (M.promotion && Bm.promotion && M.promotion !== Bm.promotion) return `A ${PNAME[Bm.promotion]} is worth more than a ${PNAME[M.promotion]}.`;
  // 2. it wins material, or the move played loses some, over the next few moves. Only claimed when Stockfish's
  // scores back it up: a move that just loses a piece isn't rated "good", so a big difference in a short line
  // is usually only timing (the other move gets it back a bit later).
  const lb = lineGain(fen, e0.pv && e0.pv[0] === e0.best ? e0.pv : [e0.best], me, 8);
  const lm = lineGain(fen, [uciOf(M)].concat(e1.pv || []), me, 8);
  const diff = lb.gain - lm.loss, cpGap = (e0.cp || 0) + (e1.cp || 0);
  if (diff >= 0.9 && cpGap >= 70 * diff) {
    if (lb.gain >= 0.9) return `It wins ${amount(diff)}${lineTo(lb.played)}.`;
    if (lm.loss <= -0.9) return `After ${SAN(M.san)}, ${who.name(opp, true)} can win ${amount(diff)}${lineTo(lm.played)}. ${SAN(Bm.san)} keeps everything safe.`;
  }
  const out = [];
  // 3. what the best move does that the move played doesn't
  // general ideas (developing, castling...) count as shared when both moves do them, even with different pieces
  const key = x => ["grab", "fork", "pin", "threat", "attack", "file"].includes(x.k) ? x.t : x.k;
  const mine = new Set(moveIdeas(fen, M.san).map(key));
  const extra = moveIdeas(fen, Bm.san).filter(x => !mine.has(key(x))).slice(0, 2);
  if (extra.length) out.push(`It ${extra.map(x => x.t).join(extra[0].t.includes(",") ? ", and " : " and ")}.`);
  // 4. the move played allows a strong answer that the best move doesn't
  const R = e1.best ? uciToMove(G.fens[i + 1], e1.best) : null;
  if (R) {
    const cB = new Chess(fen); cB.move(Bm.san);
    const afterBest = new Set(moveIdeas(cB.fen(), R.from + R.to + (R.promotion || "")).map(x => x.t));
    const hit = moveIdeas(G.fens[i + 1], R.san).find(x => ["fork", "pin", "threat", "attack", "check"].includes(x.k) && !afterBest.has(x.t));
    if (hit) out.push(`After ${SAN(M.san)}, ${who.name(opp, true)} can answer ${SAN(R.san)}, which ${hit.t}.`);
  }
  if (!out.length && weakensKing(fen, M.san) && !weakensKing(fen, Bm.san)) out.push(`${SAN(M.san)} loosens the pawns in front of the king.`);
  if (!out.length) {
    const a = mobility(fen, Bm.san), b = mobility(fen, M.san);
    if (a !== null && b !== null && a - b >= 5) out.push("It gives the pieces more room to move.");
  }
  // 5. nothing simple to point at: give the numbers
  if (!out.length) {
    const evB = evalText(e0, me), evM = evalText(e1, opp);
    out.push(evB !== evM ? `The difference is small: Stockfish gives ${evB} after ${SAN(Bm.san)} and ${evM} after ${SAN(M.san)}.` : "The difference is small.");
    out.push("Press Show best line to see the plan.");
  }
  return out.join(" ");
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
    if (bestSan) { const why = whyStronger(G, i, who); if (why) out.push(why); }
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
