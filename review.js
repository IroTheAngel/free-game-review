"use strict";
/* The review page: loads a finished game, has Stockfish rate every move, and lets you step through it,
   look at the best lines, explore your own moves and practise your mistakes. */

const VER = 1; // saved engine results format; bump to make old saved reviews run again (ratings are always recomputed)
const DEPTHS = { 12: 1500, 16: 4000, 20: 10000 }; // depth -> time cap per position (ms)
const FILES = "abcdefgh";
const params = new URLSearchParams(location.search);
const S = {
  G: null, R: [], ply: 0, side: "w", me: null, meta: null, key: null,
  depth: +prefs.get("depth", 16) in DEPTHS ? +prefs.get("depth", 16) : 16,
  analysing: false, done: 0, total: 0, accuracy: null, err: null,
  v: null, live: null, prac: null, sel: null, drag: null, anim: null
};
let OPEN = {}, pool = null, sound = prefs.get("sound", true), ac = null;
const who = {
  name(color, lower) {
    if (S.me) { const s = color === S.me ? "You" : "Your opponent"; return lower ? s[0].toLowerCase() + s.slice(1) : s; }
    return color === "w" ? "White" : "Black";
  }
};

/* ---------- sounds (same as the trainer) ---------- */
function tone(cap) {
  if (!sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = "triangle"; o.frequency.setValueAtTime(cap ? 260 : 180, t); o.frequency.exponentialRampToValueAtTime(cap ? 120 : 90, t + .08);
    f.type = "lowpass"; f.frequency.value = 1400; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(cap ? .5 : .35, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + (cap ? .14 : .09));
    o.connect(f); f.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + .16);
  } catch (e) { }
}
function chime() {
  if (!sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    [523, 659, 784].forEach((fr, i) => {
      const t = ac.currentTime + i * .09, o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = fr; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .3);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + .32);
    });
  } catch (e) { }
}

/* ---------- header buttons ---------- */
function drawHeaderBtns() {
  $("soundBtn").innerHTML = `<img class="ico" src="img/sound-${sound ? "on" : "off"}.png" alt="">`;
  $("soundBtn").setAttribute("aria-label", sound ? "Sound on" : "Sound off");
  const light = document.documentElement.getAttribute("data-mode") === "light";
  $("themeBtn").innerHTML = light ? '<svg viewBox="0 0 24 24"><path d="M12.3 2a8 8 0 1 0 9.7 9.7A8.5 8.5 0 0 1 12.3 2z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10M11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z"/></svg>';
  $("themeBtn").setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
  document.querySelectorAll("#depthSeg button").forEach(b => b.setAttribute("aria-checked", String(+b.dataset.d === S.depth)));
}
$("soundBtn").addEventListener("click", () => { sound = !sound; prefs.set("sound", sound); drawHeaderBtns(); });
$("themeBtn").addEventListener("click", () => {
  const light = document.documentElement.getAttribute("data-mode") === "light";
  prefs.set("theme", light ? "dark" : "light"); applyTheme(); drawHeaderBtns();
});
$("settingsBtn").addEventListener("click", e => { e.stopPropagation(); const p = $("settings"); p.hidden = !p.hidden; $("settingsBtn").setAttribute("aria-expanded", String(!p.hidden)); });
document.addEventListener("click", e => { const p = $("settings"); if (!p.hidden && !p.contains(e.target)) { p.hidden = true; $("settingsBtn").setAttribute("aria-expanded", "false"); } });
$("depthSeg").addEventListener("click", e => {
  const b = e.target.closest("button[data-d]"); if (!b) return;
  const d = +b.dataset.d; if (d === S.depth) return;
  S.depth = d; prefs.set("depth", d); drawHeaderBtns();
  if (S.G) reanalyse();
});

/* ---------- board ---------- */
const sqEls = {};
function buildBoard() {
  const el = $("squares"); el.innerHTML = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const f = S.side === "w" ? x : 7 - x, r = S.side === "w" ? 7 - y : y, s = FILES[f] + (r + 1);
    const d = document.createElement("div");
    d.dataset.sq = s; d.dataset.c = (f + r) % 2 ? "l" : "d"; d.className = "sq " + d.dataset.c;
    if (x === 0) d.insertAdjacentHTML("beforeend", `<span class="coord r">${r + 1}</span>`);
    if (y === 7) d.insertAdjacentHTML("beforeend", `<span class="coord f">${FILES[f]}</span>`);
    el.appendChild(d); sqEls[s] = d;
  }
  $("evalbar").classList.toggle("flipped", S.side === "b");
}
// "Staunty" pieces by sadsnake1 (CC BY-NC-SA 4.0, see pieces/staunty/LICENSE.txt)
const pieceSVG = p => `<img src="pieces/staunty/${p.color}${p.type.toUpperCase()}.svg" alt="" draggable="false">`;
// load all twelve up front so the first moves don't flicker
"wb".split("").forEach(c => "KQRBNP".split("").forEach(t => { const im = new Image(); im.src = `pieces/staunty/${c}${t}.svg`; }));
function xy(s) { const f = FILES.indexOf(s[0]), r = +s[1] - 1; return S.side === "b" ? { x: 7 - f, y: r } : { x: f, y: 7 - r }; }
function arrowSVG(f, t, c, o) {
  const A = xy(f), B = xy(t), dx = B.x - A.x, dy = B.y - A.y, C = q => [q.x * 100 + 50, q.y * 100 + 50];
  const pts = Math.abs(dx * dy) === 2 ? [C(A), C(Math.abs(dy) === 2 ? { x: A.x, y: B.y } : { x: B.x, y: A.y }), C(B)] : [C(A), C(B)];
  const W = 17, HL = 38, HW = 23, n = pts.length;
  const ux = pts[1][0] - pts[0][0], uy = pts[1][1] - pts[0][1], ul = Math.hypot(ux, uy);
  pts[0] = [pts[0][0] + ux / ul * 22, pts[0][1] + uy / ul * 22];
  let vx = pts[n - 1][0] - pts[n - 2][0], vy = pts[n - 1][1] - pts[n - 2][1]; const vl = Math.hypot(vx, vy); vx /= vl; vy /= vl;
  const tip = [pts[n - 1][0] - vx * 4, pts[n - 1][1] - vy * 4], base = [tip[0] - vx * HL, tip[1] - vy * HL];
  pts[n - 1] = base;
  const pt = q => Math.round(q[0] * 10) / 10 + "," + Math.round(q[1] * 10) / 10;
  return `<g opacity="${o}"><polyline points="${pts.map(pt).join(" ")}" fill="none" stroke-width="${W}" stroke-linejoin="miter" style="stroke:${c}"/><polygon points="${pt(tip)} ${pt([base[0] - vy * HW, base[1] + vx * HW])} ${pt([base[0] + vy * HW, base[1] - vx * HW])}" style="fill:${c}"/></g>`;
}
const N = () => S.G ? S.G.moves.length : 0;
// the position on the board right now
function curFen() {
  const G = S.G; if (!G) return new Chess().fen();
  if (S.prac) { const P = S.prac; return P.tryFen || G.fens[P.list[P.k]]; }
  if (S.v) return S.v.idx >= 0 ? S.v.moves[S.v.idx].fen : G.fens[S.v.base];
  return G.fens[S.ply];
}
function lastMove() {
  const G = S.G; if (!G) return null;
  if (S.prac) { const P = S.prac, i = P.list[P.k]; return P.tryMove || (i > 0 ? G.moves[i - 1] : null); }
  if (S.v) return S.v.idx >= 0 ? S.v.moves[S.v.idx] : (S.v.base > 0 ? G.moves[S.v.base - 1] : null);
  return S.ply > 0 ? G.moves[S.ply - 1] : null;
}
function curRating() {
  if (S.prac) return S.prac.badge || null;
  if (S.v || !S.G || S.ply === 0) return null;
  const r = S.R[S.ply - 1]; return r && r.cls ? { sq: S.G.moves[S.ply - 1].to, cls: r.cls } : null;
}
function arrowsNow() {
  const G = S.G, out = []; if (!G) return out;
  if (S.prac) { const P = S.prac, e = G.E[P.list[P.k]]; if (P.showArrow && e && e.best) out.push({ f: e.best.slice(0, 2), t: e.best.slice(2, 4), c: "var(--best-arrow)", o: .85 }); return out; }
  if (S.v) {
    const L = S.live;
    if (L && L.fen === curFen() && L.best && S.v.kind === "free") out.push({ f: L.best.slice(0, 2), t: L.best.slice(2, 4), c: "var(--next)", o: .7 });
    return out;
  }
  if (S.ply > 0) {
    const r = S.R[S.ply - 1], e = G.E[S.ply - 1];
    if (r && e && e.best && !["best", "book", "brilliant", "great"].includes(r.cls) && e.best !== r.uci)
      out.push({ f: e.best.slice(0, 2), t: e.best.slice(2, 4), c: "var(--best-arrow)", o: .78 });
  }
  return out;
}
function drawBoard() {
  const fen = curFen(), c = new Chess(fen), last = lastMove(), rt = curRating();
  const dests = S.sel ? c.moves({ square: S.sel, verbose: true }) : [];
  $("board").classList.toggle("can", canMove());
  for (const s in sqEls) {
    const el = sqEls[s];
    el.querySelectorAll(".piece,.dot,.badge").forEach(n => n.remove());
    let cls = "sq " + el.dataset.c;
    if (last && (last.from === s || last.to === s)) cls += rt && rt.cls ? " tint r-" + rt.cls : " last";
    if (S.sel === s) cls += " sel";
    const p = c.get(s);
    if (p && p.type === "k" && p.color === c.turn() && c.in_check()) cls += " check";
    el.className = cls;
    if (p) { const d = document.createElement("div"); d.className = "piece" + (S.drag && S.drag.moved && S.drag.from === s ? " lift" : ""); d.innerHTML = pieceSVG(p); el.appendChild(d); }
    const dm = dests.find(m => m.to === s);
    if (dm) { const d = document.createElement("div"); d.className = "dot" + (dm.captured ? " cap" : ""); el.appendChild(d); }
    if (rt && rt.sq === s && RT[rt.cls]) { const b = document.createElement("div"); b.className = "badge r-" + rt.cls; b.innerHTML = badgeInner(rt.cls); b.title = RT[rt.cls].l; el.appendChild(b); }
  }
  if (S.anim) {
    const { from, to } = S.anim, a = xy(from), b = xy(to), pc = sqEls[to] && sqEls[to].querySelector(".piece");
    if (pc) { pc.style.transition = "none"; pc.style.transform = `translate(${(a.x - b.x) * 100}%,${(a.y - b.y) * 100}%)`; pc.getBoundingClientRect(); pc.style.transition = "transform .16s ease-out"; pc.style.transform = ""; }
    if (S.anim.flags && /[kq]/.test(S.anim.flags)) {
      const h = S.anim.color === "w" ? "1" : "8", rk = S.anim.flags.includes("k") ? ["h" + h, "f" + h] : ["a" + h, "d" + h];
      const rp = sqEls[rk[1]].querySelector(".piece"), ra = xy(rk[0]), rb = xy(rk[1]);
      if (rp) { rp.style.transition = "none"; rp.style.transform = `translate(${(ra.x - rb.x) * 100}%,0)`; rp.getBoundingClientRect(); rp.style.transition = "transform .16s ease-out"; rp.style.transform = ""; }
    }
    S.anim = null;
  }
  $("arrows").innerHTML = arrowsNow().map(a => arrowSVG(a.f, a.t, a.c, a.o)).join("");
}
function drawEval() {
  const G = S.G; let ev = null, fen = curFen();
  if (G) {
    if (S.prac) ev = G.E[S.prac.list[S.prac.k]];
    else if (S.v) ev = S.live && S.live.fen === fen ? S.live.ev : null;
    else ev = G.E[S.ply];
  }
  const turn = fen.split(" ")[1], ww = ev ? whiteWin(ev, turn) : 50;
  const show = Math.max(4, Math.min(96, ww));
  $("evalFill").style.height = show + "%";
  const L = $("evalLbl"); L.textContent = ev ? evalText(ev, turn).replace(/^\+/, "") : "";
  const whiteAhead = ww >= 50;
  // the number sits on the side that is better
  L.className = "lbl " + ((whiteAhead) === (S.side === "w") ? "bot" : "top");
}
function fmtClock(sec) {
  if (sec === null || sec === undefined) return "";
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const ss = sec < 20 ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
function clockAt(color, ply) {
  const G = S.G; if (!G || !G.clocks.length) return null;
  let v = G.base;
  for (let k = 0; k < ply && k < G.moves.length; k++) if (G.moves[k].color === color && G.clocks[k] !== undefined) v = G.clocks[k];
  return v;
}
function drawPlayers() {
  const M = S.meta; if (!M) return;
  const ply = S.prac ? S.prac.list[S.prac.k] : S.v ? S.v.base : S.ply;
  const strip = color => {
    const p = color === "w" ? M.white : M.black, cl = clockAt(color, ply);
    const low = cl !== null && G_low(cl);
    return `<span class="pic ${color}">${pieceSVG({ color, type: "k" })}</span>` +
      `<span class="nm">${esc(p.name)}</span>${p.rating ? `<span class="rt">(${esc(p.rating)})</span>` : ""}${S.me === color ? '<span class="you">YOU</span>' : ""}` +
      (cl !== null ? `<span class="clock${low ? " low" : ""}">${fmtClock(cl)}</span>` : "");
  };
  $("pTop").innerHTML = strip(S.side === "w" ? "b" : "w");
  $("pBot").innerHTML = strip(S.side);
}
const G_low = cl => S.G && S.G.base ? cl < Math.min(20, S.G.base * 0.1) : false;

/* ---------- panel ---------- */
function setStatus(html) { $("status").innerHTML = html || ""; }
function progressHTML() {
  const pct = S.total ? Math.round(S.done / S.total * 100) : 0;
  return `<div class="row"><span class="spin"></span>Reviewing the game… ${S.done} / ${S.total} positions</div>` +
    `<div class="bar"><i style="width:${pct}%"></i></div>` +
    `<div class="muted small">Stockfish 18 · depth ${S.depth} · ${pool ? pool.size : 1} engine${pool && pool.size === 1 ? "" : "s"} working side by side</div>`;
}
function errorHTML(t, extra) {
  return `<div class="err"><img class="ico" src="img/warning.png" alt=""><div>${t}${extra || ""}</div></div>`;
}
const pending = () => S.analysing && S.done < S.total;
function counts() {
  const c = { w: {}, b: {} };
  S.R.forEach((r, i) => { if (r && r.cls) { const col = S.G.moves[i].color; c[col][r.cls] = (c[col][r.cls] || 0) + 1; } });
  return c;
}
function practiceList() {
  return S.R.map((r, i) => ({ r, i })).filter(x => x.r && ["mistake", "miss", "blunder"].includes(x.r.cls) && (!S.me || S.G.moves[x.i].color === S.me)).map(x => x.i);
}
function rb(k) { return `<span class="rb r-${k}">${badgeInner(k)}</span>`; }

function drawCoach() {
  const el = $("coach"), G = S.G; if (!G) { el.hidden = true; return; }
  el.hidden = false;
  let h = "";
  if (S.prac) { el.innerHTML = practiceCoach(); bindCoach(); return; }
  if (S.v) {
    const V = S.v, base = G.fens[V.base];
    h += `<div class="bubble">`;
    if (V.kind === "best") {
      const played = G.moves[V.base];
      h += `<div class="head">The engine's best line</div><div class="body">Instead of ${SAN(played.san)}, the engine plays:</div>`;
    } else {
      const L = S.live && S.live.fen === curFen() ? S.live : null;
      const bm = L && L.best ? uciToMove(curFen(), L.best) : null;
      h += `<div class="head">Exploring your own moves${L ? `<span class="ev ${whiteWin(L.ev, curFen().split(" ")[1]) >= 50 ? "wv" : ""}">${evalText(L.ev, curFen().split(" ")[1])}</span>` : ""}</div>` +
        `<div class="body">${L ? (bm ? `The engine's choice here: ${SAN(bm.san)}${L.done ? "" : " (thinking…)"}` : new Chess(curFen()).game_over() ? "The game is over in this position." : "Thinking…") : "Thinking…"}</div>`;
    }
    h += `<div class="line">${varLineHTML()}</div>`;
    h += `<div class="cbtns"><button class="btn primary small" id="vBack">Back to the game</button></div></div>`;
    el.innerHTML = `<div class="av"><img src="img/magnifier.png" alt=""></div>` + h; bindCoach(); return;
  }
  if (S.ply === 0) {
    if (pending()) h = `<div class="head">Let's look at your game!</div><div class="body">Stockfish is checking every move. You can already step through the moves that are done.</div>`;
    else if (S.accuracy) {
      const A = S.accuracy, c = counts(), mine = S.me;
      const bad = col => (c[col].blunder || 0) + (c[col].mistake || 0) + (c[col].miss || 0);
      const good = col => (c[col].brilliant || 0) + (c[col].great || 0);
      if (mine) h = `<div class="head">You played with ${A[mine].toFixed(1)}% accuracy</div><div class="body">${good(mine) ? `You found ${good(mine)} great move${good(mine) > 1 ? "s" : ""}. ` : ""}${bad(mine) ? `There ${bad(mine) > 1 ? "are" : "is"} ${bad(mine)} big moment${bad(mine) > 1 ? "s" : ""} to learn from.` : "No big mistakes, nice!"}</div>`;
      else h = `<div class="head">Review ready</div><div class="body">White played with ${A.w.toFixed(1)}% accuracy, Black with ${A.b.toFixed(1)}%.</div>`;
      h += `<div class="cbtns"><button class="btn primary small" id="cStart">Start review</button></div>`;
    } else h = `<div class="head">Getting ready…</div>`;
    el.innerHTML = `<div class="av"><img src="img/chat.png" alt=""></div><div class="bubble">${h}</div>`; bindCoach(); return;
  }
  const i = S.ply - 1, r = S.R[i], m = G.moves[i];
  if (!r || !r.cls) {
    h = `<div class="head">${SAN(m.san)}</div><div class="body">Checking this move…</div>`;
  } else {
    const t = coachText(G, i, S.R, who), e = G.E[S.ply], turn = G.fens[S.ply].split(" ")[1];
    h = `<div class="head">${rb(r.cls)}<span class="rt-${r.cls}">${t.head}</span><span class="ev ${whiteWin(e, turn) >= 50 ? "wv" : ""}">${evalText(e, turn)}</span></div><div class="body">${t.body}</div>`;
    const btns = [];
    if (!["best", "book", "brilliant", "great"].includes(r.cls) && G.E[i].pv && G.E[i].pv.length) btns.push(`<button class="btn ghost small" id="cBest">Show best line</button>`);
    if (["mistake", "miss", "blunder"].includes(r.cls) && (!S.me || m.color === S.me) && !pending()) btns.push(`<button class="btn ghost small" id="cRetry"><img class="ico" src="img/retry.png" alt="">Retry</button>`);
    btns.push(`<button class="btn primary small" id="cNext"${S.ply >= N() ? " disabled" : ""}>Next</button>`);
    h += `<div class="cbtns">${btns.join("")}</div>`;
  }
  el.innerHTML = `<div class="av"><img src="img/chat.png" alt=""></div><div class="bubble">${h}</div>`;
  bindCoach();
}
function varLineHTML() {
  const V = S.v, G = S.G; if (!V.moves.length) return "";
  const startPly = V.base, startNo = Math.floor(startPly / 2) + 1, black = G.fens[V.base].split(" ")[1] === "b";
  let h = "";
  V.moves.forEach((mv, k) => {
    const ply = (black ? 1 : 0) + k, no = startNo + Math.floor(ply / 2);
    if (k === 0 && black) h += `${no}… `; else if (ply % 2 === 0) h += `${no}. `;
    h += `<button data-vk="${k}" class="${k === V.idx ? "on" : ""}">${esc(mv.san)}</button> `;
  });
  return h;
}
function bindCoach() {
  const on = (id, f) => { const b = $(id); if (b) b.addEventListener("click", f); };
  on("cStart", () => go(1));
  on("cNext", () => go(S.ply + 1));
  on("cBest", () => showBestLine(S.ply - 1));
  on("cRetry", () => startPractice(S.ply - 1));
  on("vBack", exitVariation);
  document.querySelectorAll("#coach [data-vk]").forEach(b => b.addEventListener("click", () => { S.v.idx = +b.dataset.vk; S.sel = null; afterVarStep(); }));
  bindPractice();
}

function drawGraph() {
  const G = S.G, el = $("graph");
  if (!G || !G.E.some(Boolean)) { el.hidden = true; return; }
  el.hidden = false;
  const n = G.fens.length, W = 1000, H = 100, x = i => n > 1 ? i / (n - 1) * W : 0;
  let pts = [], last = 50;
  for (let i = 0; i < n; i++) { const e = G.E[i]; if (e) last = whiteWin(e, G.fens[i].split(" ")[1]); pts.push([x(i), H - last]); }
  const area = `M0,${H} ` + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + ` L${W},${H} Z`;
  let dots = "";
  S.R.forEach((r, i) => {
    if (!r || !["brilliant", "great", "mistake", "miss", "blunder"].includes(r.cls)) return;
    const p = pts[i + 1];
    dots += `<line x1="${p[0]}" y1="${p[1]}" x2="${p[0]}" y2="${p[1]}" stroke="var(--r-${r.cls === "inaccuracy" ? "inacc" : r.cls})" stroke-width="7" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  });
  const cx = x(S.prac ? S.prac.list[S.prac.k] : S.v ? S.v.base : S.ply);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evaluation graph. Click to jump to a move.">` +
    `<path d="${area}" fill="#f1efe9"/><line x1="0" y1="50" x2="${W}" y2="50" stroke="#8a857c" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="3 3"/>` +
    `<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="var(--arrow)" stroke-width="2" vector-effect="non-scaling-stroke"/>${dots}</svg>`;
}
$("graph").addEventListener("click", e => {
  if (!S.G || S.prac) return;
  const r = e.currentTarget.getBoundingClientRect(), n = S.G.fens.length;
  go(Math.round((e.clientX - r.left) / r.width * (n - 1)));
});

function drawSummary() {
  const el = $("summary"), G = S.G;
  if (!G || S.ply !== 0 || S.v || S.prac || !S.R.some(Boolean)) { el.hidden = true; return; }
  el.hidden = false;
  const M = S.meta, c = counts(), A = S.accuracy;
  const box = col => {
    const p = col === "w" ? M.white : M.black;
    return `<div class="accbox ${col}"><div class="who">${esc(p.name)}${S.me === col ? " (you)" : ""}</div><div class="num">${A && A[col] !== null ? A[col].toFixed(1) : "…"}</div><div class="lab">Accuracy</div></div>`;
  };
  let rows = "";
  for (const k of RT_ORDER) {
    const a = c.w[k] || 0, b = c.b[k] || 0;
    rows += `<span class="c${a ? "" : " zero"}">${a}</span><span class="k r-${k}">${rb(k)}${RT[k].l}</span><span class="c${b ? "" : " zero"}">${b}</span>`;
  }
  el.innerHTML = `<div class="acc">${box("w")}${box("b")}</div><div class="counts">${rows}</div>` +
    (G.opening ? `<div class="opening"><img src="img/book.png" alt="">${esc(G.opening)}</div>` : "");
}

function drawMoves() {
  const el = $("moves"), G = S.G; if (!G || !G.moves.length) { el.hidden = true; return; }
  el.hidden = false;
  const black = G.fens[0].split(" ")[1] === "b", startNo = +G.fens[0].split(" ")[5];
  let h = "";
  G.moves.forEach((m, k) => {
    const ply = (black ? 1 : 0) + k, no = startNo + Math.floor(ply / 2), r = S.R[k];
    if (ply % 2 === 0 || k === 0) h += `<div class="mrow"><span class="n">${no}.</span>${ply % 2 ? "<span></span>" : ""}`;
    const cls = r && r.cls, mark = cls && NOTABLE.has(cls) ? rb(cls) : "";
    h += `<button class="mv${S.ply === k + 1 && !S.v && !S.prac ? " cur" : ""}${cls === "book" ? " bk" : ""}${!cls ? " pending" : ""}" data-ply="${k + 1}">${esc(m.san)}${mark}</button>`;
    if (ply % 2 === 1 || k === G.moves.length - 1) h += "</div>";
  });
  el.innerHTML = h;
  const cur = el.querySelector(".mv.cur");
  if (cur) { const t = cur.offsetTop - el.offsetTop, b = t + cur.offsetHeight; if (t < el.scrollTop + 4) el.scrollTop = t - 30; else if (b > el.scrollTop + el.clientHeight - 4) el.scrollTop = b - el.clientHeight + 30; }
}
$("moves").addEventListener("click", e => { const b = e.target.closest("[data-ply]"); if (b && !S.prac) go(+b.dataset.ply); });

function drawActions() {
  const el = $("actions"), G = S.G;
  if (!G || S.prac || S.v || pending() || !S.R.some(Boolean)) { el.hidden = true; return; }
  const L = practiceList();
  el.hidden = false;
  el.innerHTML = L.length ? `<button class="btn ghost" id="aPrac"><img class="ico" src="img/target.png" alt="">Practise ${S.me ? "my" : "the"} mistakes (${L.length})</button>`
    : `<div class="muted small">No mistakes or blunders${S.me ? " from you" : ""} to practise. Nice game!</div>`;
  const b = $("aPrac"); if (b) b.addEventListener("click", () => startPractice(null));
}
function render() {
  if (!S.G) return;
  drawBoard(); drawEval(); drawPlayers(); drawCoach(); drawGraph(); drawSummary(); drawMoves(); drawActions();
  $("nPrev").disabled = !!S.prac || (!S.v && S.ply === 0);
  $("nFirst").disabled = !!S.prac || (!S.v && S.ply === 0);
  $("nNext").disabled = !!S.prac || (S.v ? S.v.idx >= S.v.moves.length - 1 : S.ply >= N());
  $("nLast").disabled = !!S.prac || (S.v ? S.v.idx >= S.v.moves.length - 1 : S.ply >= N());
}

/* ---------- moving around ---------- */
function go(p) {
  if (!S.G) return;
  p = Math.max(0, Math.min(N(), p));
  const fwd = p === S.ply + 1 && !S.v;
  S.v = null; S.sel = null; S.live = null;
  if (fwd) { const m = S.G.moves[p - 1]; S.anim = m; tone(!!m.captured); }
  else if (p !== S.ply) { const m = p > 0 ? S.G.moves[p - 1] : null; if (m) tone(!!m.captured); }
  S.ply = p; render();
}
function exitVariation() { S.v = null; S.sel = null; S.live = null; render(); }
function showBestLine(i) {
  const G = S.G, e = G.E[i]; if (!e || !e.pv) return;
  const c = new Chess(G.fens[i]), moves = [];
  for (const u of e.pv.slice(0, 10)) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); if (!m) break; moves.push(Object.assign({}, m, { uci: uciOf(m), fen: c.fen() })); }
  if (!moves.length) return;
  S.v = { base: i, moves, idx: 0, kind: "best" }; S.sel = null; S.anim = moves[0]; tone(!!moves[0].captured); render();
}
function afterVarStep() {
  const V = S.v; if (V.idx >= 0) { const m = V.moves[V.idx]; tone(!!m.captured); }
  if (V.kind === "free") askLive();
  render();
}
function step(d) {
  if (S.prac) return;
  if (S.v) {
    const V = S.v;
    if (d > 0 && V.idx < V.moves.length - 1) { V.idx++; S.anim = V.moves[V.idx]; afterVarStep(); }
    else if (d < 0) { if (V.idx >= 0) { V.idx--; afterVarStep(); } else exitVariation(); }
    return;
  }
  go(S.ply + d);
}
$("nFirst").addEventListener("click", () => { if (S.v) { S.v.idx = -1; afterVarStep(); } else go(0); });
$("nPrev").addEventListener("click", () => step(-1));
$("nNext").addEventListener("click", () => step(1));
$("nLast").addEventListener("click", () => { if (S.v) { S.v.idx = S.v.moves.length - 1; afterVarStep(); } else go(N()); });
$("nFlip").addEventListener("click", flip);
function flip() { S.side = S.side === "w" ? "b" : "w"; buildBoard(); render(); }
document.addEventListener("keydown", e => {
  if (e.target.closest("input,textarea,select") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
  else if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
  else if (e.key === "Home" || e.key === "ArrowUp") { if (!S.prac) { S.v ? (S.v.idx = -1, afterVarStep()) : go(0); } e.preventDefault(); }
  else if (e.key === "End" || e.key === "ArrowDown") { if (!S.prac) { S.v ? (S.v.idx = S.v.moves.length - 1, afterVarStep()) : go(N()); } e.preventDefault(); }
  else if (e.key === "f" || e.key === "F") flip();
  else if (e.key === "Escape") { if (S.v) exitVariation(); else if (S.prac) endPractice(); }
});

/* ---------- moving pieces (explore, or practise) ---------- */
function canMove() {
  if (!S.G) return false;
  if (S.prac) return S.prac.state === "ask" || S.prac.state === "wrong";
  return true;
}
function sqAt(e) {
  const r = $("board").getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * 8), y = Math.floor((e.clientY - r.top) / r.height * 8);
  if (x < 0 || x > 7 || y < 0 || y > 7) return null;
  const f = S.side === "w" ? x : 7 - x, rk = S.side === "w" ? 7 - y : y;
  return FILES[f] + (rk + 1);
}
const board = $("board");
board.addEventListener("pointerdown", e => {
  if (e.button !== 0 || !canMove()) return;
  const s = sqAt(e); if (!s) return;
  const c = new Chess(curFen()), p = c.get(s);
  if (S.sel && S.sel !== s && c.moves({ square: S.sel, verbose: true }).some(m => m.to === s)) { const f = S.sel; S.sel = null; userMove(f, s); return; }
  if (p && p.color === c.turn()) {
    S.sel = s; S.drag = { from: s, x: e.clientX, y: e.clientY, moved: false, ghost: null };
    try { board.setPointerCapture(e.pointerId); } catch (er) { }
    drawBoard();
  } else if (S.sel) { S.sel = null; drawBoard(); }
});
board.addEventListener("pointermove", e => {
  const D = S.drag; if (!D) return;
  if (!D.moved && Math.hypot(e.clientX - D.x, e.clientY - D.y) > 5) {
    D.moved = true;
    const p = new Chess(curFen()).get(D.from), size = board.getBoundingClientRect().width / 8;
    D.ghost = document.createElement("div"); D.ghost.className = "ghostpc"; D.ghost.style.width = D.ghost.style.height = size + "px"; D.ghost.innerHTML = pieceSVG(p);
    document.body.appendChild(D.ghost); drawBoard();
  }
  if (D.ghost) { D.ghost.style.left = e.clientX + "px"; D.ghost.style.top = e.clientY + "px"; }
});
function endDrag(e, cancel) {
  const D = S.drag; if (!D) return;
  S.drag = null; if (D.ghost) D.ghost.remove();
  const t = cancel ? null : sqAt(e);
  if (D.moved) { if (t && t !== D.from && userMove(D.from, t)) return; S.sel = null; drawBoard(); }
}
board.addEventListener("pointerup", e => endDrag(e, false));
board.addEventListener("pointercancel", e => endDrag(e, true));

function userMove(from, to) {
  const fen = curFen(), c = new Chess(fen), m = c.move({ from, to, promotion: "q" });
  if (!m) return false;
  S.sel = null;
  const mv = Object.assign({}, m, { uci: uciOf(m), fen: c.fen() });
  if (S.prac) { practiceMove(mv); return true; }
  const G = S.G;
  // playing the game's own next move just steps forward
  if (!S.v && S.ply < N() && uciOf(G.moves[S.ply]) === mv.uci) { go(S.ply + 1); return true; }
  if (S.v && S.v.idx + 1 < S.v.moves.length && S.v.moves[S.v.idx + 1].uci === mv.uci) { S.v.idx++; S.anim = mv; afterVarStep(); return true; }
  const V = S.v || { base: S.ply, moves: [], idx: -1, kind: "free" };
  V.moves = V.moves.slice(0, V.idx + 1); V.moves.push(mv); V.idx = V.moves.length - 1; V.kind = "free";
  S.v = V; S.anim = mv; tone(!!mv.captured); askLive(); render();
  return true;
}

/* ---------- the engine on the board you're exploring ---------- */
const live = { eng: null, seq: 0 };
function liveRun(fen, opts) {
  const seq = ++live.seq;
  if (!live.eng || live.eng.dead) live.eng = new Engine();
  live.eng.stop();
  const tryRun = () => live.eng.run(fen, Object.assign({}, opts, { onInfo: opts.onInfo ? l => { if (seq === live.seq) opts.onInfo(l); } : null }))
    .catch(err => { if (err.message === "busy" && seq === live.seq) return new Promise(r => setTimeout(r, 40)).then(() => seq === live.seq ? tryRun() : null); throw err; });
  return tryRun().then(r => seq === live.seq ? r : null);
}
function askLive() {
  const fen = curFen(), c = new Chess(fen);
  if (c.game_over()) { S.live = { fen, ev: c.in_checkmate() ? { cp: null, mate: 0 } : { cp: 0, mate: null }, best: null, done: true }; return; }
  S.live = { fen, ev: null, best: null, done: false };
  const upd = (lines, done, best) => {
    if (!S.v || curFen() !== fen || !lines || !lines[0]) return;
    S.live = { fen, ev: { cp: lines[0].cp, mate: lines[0].mate }, best: best || lines[0].pv[0], done };
    drawEval(); drawCoach(); $("arrows").innerHTML = arrowsNow().map(a => arrowSVG(a.f, a.t, a.c, a.o)).join("");
  };
  liveRun(fen, { depth: 18, ms: 3000, multipv: 1, onInfo: l => upd(l, false) }).then(r => { if (r) upd(r.lines, true, r.best); }).catch(() => { });
}

/* ---------- practise your mistakes ---------- */
function startPractice(fromPly) {
  const list = practiceList(); if (!list.length) return;
  let k = fromPly === null ? 0 : list.indexOf(fromPly); if (k < 0) k = 0;
  S.v = null; S.sel = null;
  S.prac = { list, k, res: list.map(() => null), state: "ask", tries: 0, hinted: false, lastTry: null, tryFen: null, tryMove: null, badge: null, showArrow: false, msg: "" };
  const col = S.G.moves[list[k]].color; if (col !== S.side) { S.side = col; buildBoard(); }
  render();
}
function endPractice() { const P = S.prac; S.prac = null; if (P) S.ply = Math.min(N(), P.list[P.k] + 1); render(); }
function practiceGoto(k) {
  const P = S.prac; P.k = k; P.state = "ask"; P.tries = 0; P.hinted = false; P.lastTry = null; P.tryFen = null; P.tryMove = null; P.badge = null; P.showArrow = false; P.msg = "";
  const col = S.G.moves[P.list[k]].color; if (col !== S.side) { S.side = col; buildBoard(); }
  render();
}
async function practiceMove(mv) {
  const P = S.prac, G = S.G, i = P.list[P.k], e0 = G.E[i], wpB = winPct(e0);
  P.tryFen = mv.fen; P.tryMove = mv; P.badge = null; P.state = "checking"; S.anim = mv; tone(!!mv.captured); render();
  let cls = null;
  if (mv.uci === e0.best) cls = "best";
  else if (e0.second && mv.uci === e0.second.uci && wpB - winPct(e0.second) <= 2) cls = "excellent";
  else {
    const c = new Chess(mv.fen);
    let ev;
    if (c.in_checkmate()) ev = { mate: 0, cp: null };
    else if (c.game_over()) ev = { cp: 0, mate: null };
    else { try { const r = await liveRun(mv.fen, { depth: 14, ms: 2500, multipv: 1 }); if (!r || S.prac !== P) return; ev = r.lines[0] ? { cp: r.lines[0].cp, mate: r.lines[0].mate } : { cp: 0, mate: null }; } catch (er) { ev = null; } }
    if (S.prac !== P) return;
    if (!ev) { P.state = "wrong"; P.msg = "The engine couldn't check that move. Try another."; P.tryFen = null; P.tryMove = null; render(); return; }
    const loss = Math.max(0, wpB - (100 - winPct(ev)));
    cls = loss < 0.3 ? "best" : loss <= 2 ? "excellent" : loss <= 5 ? "good" : loss <= 10 ? "inaccuracy" : loss <= 20 ? "mistake" : "blunder";
  }
  P.badge = { sq: mv.to, cls }; P.lastTry = { san: mv.san, cls };
  if (["best", "excellent", "good"].includes(cls)) {
    // first try = solved; after a wrong try or a hint = solved late
    P.state = "right"; P.res[P.k] = P.tries === 0 && !P.hinted ? true : "late"; chime();
  } else {
    P.state = "wrong"; P.tries++;
    $("board").classList.remove("shake"); void $("board").offsetWidth; $("board").classList.add("shake");
    setTimeout(() => { if (S.prac === P && P.state === "wrong" && P.tryMove === mv) { P.tryFen = null; P.tryMove = null; P.badge = null; render(); } }, 1100);
  }
  render();
}
function practiceCoach() {
  const P = S.prac, G = S.G, i = P.list[P.k], m = G.moves[i], r = S.R[i], col = m.color;
  const dots = P.list.map((_, k) => `<i class="${P.res[k] === true ? "ok" : P.res[k] === "late" ? "late" : P.res[k] === false ? "no" : ""}${k === P.k ? " cur" : ""}"></i>`).join("");
  const top = `<div class="prac"><img class="ico" src="img/target.png" alt="">Mistake ${P.k + 1} of ${P.list.length}<span class="dots">${dots}</span></div>`;
  const e0 = G.E[i], best = uciToMove(G.fens[i], e0.best);
  let head = "", body = "", btns = [];
  const youName = who.name(col), mover = col === S.me ? "you" : (col === "w" ? "White" : "Black");
  if (P.state === "ask" || P.state === "checking") {
    head = P.state === "checking" ? "Checking your move…" : "Find a better move";
    body = `In the game, ${mover === "you" ? "you" : mover} played ${SAN(m.san)} here (${article(r.cls)} ${RT[r.cls].l.toLowerCase()}). What's better?`;
    btns = [`<button class="btn ghost small" id="pHint">Hint</button>`, `<button class="btn ghost small" id="pShow">Show answer</button>`];
  } else if (P.state === "wrong") {
    const b = P.lastTry;
    head = P.msg ? "Hmm" : `Not quite${b ? `: ${SAN(b.san)} is ${article(b.cls)} ${RT[b.cls].l.toLowerCase()}` : ""}`;
    body = P.msg || (P.tries >= 2 ? "Try again, or use the hint." : "Try again!");
    btns = [`<button class="btn ghost small" id="pHint">Hint</button>`, `<button class="btn ghost small" id="pShow">Show answer</button>`];
  } else if (P.state === "right" || P.state === "shown") {
    const t = P.tryMove;
    if (P.state === "right") { head = P.badge.cls === "best" ? "Correct! That's the best move" : "Good find! That works too"; body = P.badge.cls === "best" ? `${SAN(t.san)} is what the engine plays.` : `The engine's top move was ${best ? SAN(best.san) : "a bit different"}, but ${SAN(t.san)} keeps the advantage too.`; }
    else { head = "Here's the answer"; body = `${best ? SAN(best.san) : "The engine's move"} was the best move.`; }
    const line = pvSan(G.fens[i], e0.pv, 8);
    if (line.length > 1) body += `<div class="line">Engine line: ${line.map(esc).join(" ")}</div>`;
    btns = P.k < P.list.length - 1 ? [`<button class="btn primary small" id="pNext"><img class="ico" src="img/skip.png" alt="">Next mistake</button>`] : [`<button class="btn primary small" id="pDone">Finish</button>`];
  } else if (P.state === "end") {
    const ok = P.res.filter(x => x === true).length, late = P.res.filter(x => x === "late").length;
    head = `You solved ${ok} of ${P.list.length} on the first try`;
    body = ok === P.list.length ? "Perfect! Every mistake fixed." : (late ? `And ${late} more after another try. ` : "") + "Practise again later to make them stick.";
    btns = [`<button class="btn ghost small" id="pAgain"><img class="ico" src="img/retry.png" alt="">Again</button>`, `<button class="btn primary small" id="pExit2">Back to the review</button>`];
  }
  const ic = P.state === "right" ? "check" : P.state === "wrong" ? "close" : "target";
  return `<div class="av"><img src="img/${ic}.png" alt=""></div><div class="bubble">${top}<div class="head" style="margin-top:6px">${head}</div><div class="body">${body}</div><div class="cbtns">${btns.join("")}<button class="btn ghost small" id="pExit">Exit</button></div></div>`;
}
function bindPractice() {
  const on = (id, f) => { const b = $(id); if (b) b.addEventListener("click", f); };
  const P = S.prac; if (!P) return;
  on("pExit", endPractice); on("pExit2", endPractice);
  on("pHint", () => { const e = S.G.E[P.list[P.k]]; if (e && e.best) { S.sel = e.best.slice(0, 2); P.hinted = true; drawBoard(); } });
  on("pShow", () => {
    const i = P.list[P.k], e = S.G.E[i], mv = uciToMove(S.G.fens[i], e.best); if (!mv) return;
    const c = new Chess(S.G.fens[i]); c.move(mv.san);
    P.tryMove = Object.assign({}, mv, { uci: uciOf(mv), fen: c.fen() }); P.tryFen = c.fen(); P.badge = { sq: mv.to, cls: "best" };
    P.state = "shown"; P.showArrow = false; P.res[P.k] = false; S.anim = mv; tone(!!mv.captured); render();
  });
  on("pNext", () => practiceGoto(P.k + 1));
  on("pDone", () => { P.state = "end"; P.tryFen = null; P.tryMove = null; P.badge = null; render(); });
  on("pAgain", () => startPractice(null));
}

/* ---------- loading a game ---------- */
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const epd = fen => fen.split(" ").slice(0, 4).join(" ");
// the opening book: positions that strong players reached in several tournament games (data/book.bin, built
// from Lichess broadcast games), stored as sorted 32-bit FNV-1a hashes of "placement side castling"
let BOOK = new Uint32Array(0);
function inBookFile(fen) {
  const s = fen.split(" ").slice(0, 3).join(" ");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  let lo = 0, hi = BOOK.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (BOOK[mid] === h) return true; if (BOOK[mid] < h) lo = mid + 1; else hi = mid - 1; }
  return false;
}
function toSec(t) { const p = t.split(":").map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0]; }
function parseGame(pgn) {
  const c = new Chess();
  if (!c.load_pgn(pgn, { sloppy: true })) throw new Error("This PGN couldn't be read.");
  const H = c.header();
  if (H.Variant && !/standard/i.test(H.Variant)) throw new Error("Only standard chess games can be reviewed.");
  const hist = c.history({ verbose: true });
  if (!hist.length) throw new Error("This game has no moves.");
  const start = H.FEN || START, r = new Chess(start), fens = [r.fen()], moves = [];
  for (const m of hist) { const mm = r.move({ from: m.from, to: m.to, promotion: m.promotion }); if (!mm) break; moves.push(mm); fens.push(r.fen()); }
  const body = pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, "");
  const clocks = [...body.matchAll(/\[%clk\s+([\d:.]+)\]/g)].map(x => toSec(x[1]));
  const tc = H.TimeControl || "", base = /^\d+/.test(tc) ? +tc.split("+")[0] : null;
  const G = { fens, moves, E: new Array(fens.length).fill(null), book: [], openingAt: [], clocks: clocks.length >= moves.length - 1 ? clocks : [], base, H };
  // book moves: the position after the move is a named opening position or in the opening book. Checked for
  // each move on its own, so a game that leaves known theory and comes back to it (a transposition) is book again.
  let name = null;
  G.openingAt[0] = null;
  for (let i = 0; i < moves.length; i++) {
    const o = OPEN[epd(fens[i + 1])];
    if (o) name = o[1];
    G.book[i] = !H.FEN && (!!o || inBookFile(fens[i + 1])); G.openingAt[i + 1] = name;
  }
  G.opening = name || (H.ECOUrl ? decodeURIComponent(H.ECOUrl.split("/").pop()).replace(/-/g, " ").replace(/\.\.\./g, "") : null);
  // the game's last position, when it ended on the board
  const end = new Chess(fens[fens.length - 1]);
  if (end.in_checkmate()) G.E[fens.length - 1] = { cp: null, mate: 0, best: null, pv: [], second: null, depth: 99 };
  else if (end.in_stalemate() || end.insufficient_material()) G.E[fens.length - 1] = { cp: 0, mate: null, best: null, pv: [], second: null, depth: 99 };
  return G;
}
function setMeta(M) {
  S.meta = M;
  const title = `${M.white.name} vs ${M.black.name}` + (M.result ? ` · ${M.result}` : "") + (M.tc ? ` · ${M.tc}` : "") + (M.date ? ` · ${M.date}` : "");
  $("gameTitle").textContent = title; document.title = `${M.white.name} vs ${M.black.name} · Game Review`;
  if (M.url) { $("ccLink").href = M.url; $("ccLink").hidden = false; }
}
async function startGame(G, key) {
  S.G = G; S.key = key; S.R = new Array(G.moves.length).fill(null); S.ply = 0;
  S.side = S.me === "b" ? "b" : "w"; buildBoard();
  ["coach", "moves"].forEach(id => $(id).hidden = false);
  render();
  await analyse();
}

/* ---------- analysis ---------- */
function rateAll() {
  const G = S.G;
  for (let i = 0; i < G.moves.length; i++) {
    const prev = S.R[i - 1] || null, pc = prev ? prev.cls : null, r = S.R[i];
    if (r && r.prevCls === pc) continue;
    if (!G.E[i] || !G.E[i + 1]) { S.R[i] = null; continue; }
    const nr = rateMove(G, i, prev); if (nr) nr.prevCls = pc; S.R[i] = nr;
  }
}
let redrawT = 0;
function soon() { if (redrawT) return; redrawT = setTimeout(() => { redrawT = 0; rateAll(); setStatus(pending() ? progressHTML() : ""); render(); }, 250); }
function toE(r) {
  const L = r.lines || [], a = L[0];
  if (!a) return { cp: 0, mate: null, best: r.best && r.best !== "(none)" ? r.best : null, pv: [], second: null, depth: 0 };
  const b = L[1];
  return { cp: a.cp, mate: a.mate, best: r.best && r.best !== "(none)" ? r.best : a.pv[0], pv: a.pv.slice(0, 12), depth: a.depth,
    second: b && b.pv[0] ? { cp: b.cp, mate: b.mate, uci: b.pv[0] } : null };
}
async function analyse() {
  const G = S.G, total = G.fens.length;
  const saved = await store.get(S.key, null);
  if (saved && saved.v === VER && saved.depth >= S.depth && saved.E && saved.E.length === total) {
    G.E = saved.E; finishAnalysis(false); return;
  }
  if (!pool) pool = new EnginePool(poolSize());
  S.analysing = true; S.total = total; S.done = G.E.filter(Boolean).length;
  setStatus(progressHTML()); render();
  const run = S.runId = (S.runId || 0) + 1;
  const jobs = [];
  for (let i = 0; i < total; i++) {
    if (G.E[i]) continue;
    jobs.push(pool.run(G.fens[i], { depth: S.depth, ms: DEPTHS[S.depth], multipv: 2 }).then(r => {
      if (run !== S.runId) return;
      G.E[i] = toE(r); S.done++; soon();
    }));
  }
  try { await Promise.all(jobs); }
  catch (e) {
    if (run !== S.runId) return;
    S.analysing = false; pool.cancel();
    setStatus(errorHTML(`The chess engine stopped: ${esc(e.message)}`, `<div class="cbtns"><button class="btn ghost small" id="reRun">Try again</button></div>`));
    const b = $("reRun"); if (b) b.addEventListener("click", () => { pool = null; analyse(); });
    return;
  }
  if (run !== S.runId) return;
  finishAnalysis(true);
}
async function finishAnalysis(fresh) {
  const G = S.G;
  S.analysing = false; S.done = S.total = G.fens.length;
  S.R = new Array(G.moves.length).fill(null); rateAll();
  S.accuracy = gameAccuracy(G);
  setStatus(""); render();
  if (fresh) {
    chime();
    await store.set(S.key, { v: VER, depth: S.depth, E: G.E, t: Date.now() });
    pruneSaved();
  }
}
async function pruneSaved() {
  const all = await store.all();
  const revs = Object.entries(all).filter(([k, v]) => k.startsWith("rev:") && v && v.t).sort((a, b) => b[1].t - a[1].t);
  for (const [k] of revs.slice(40)) await store.remove(k);
  // moves read from chess.com pages are only a stopgap until the game is in the archive
  for (const [k, v] of Object.entries(all)) if (k.startsWith("pagePgn:") && (!v || Date.now() - (v.t || 0) > 2 * 864e5)) await store.remove(k);
}
async function reanalyse() {
  if (!S.G) return;
  S.prac = null; S.v = null;
  if (pool) pool.cancel();
  S.runId = (S.runId || 0) + 1;
  const end = S.G.E[S.G.fens.length - 1], keepEnd = end && end.depth === 99 ? end : null;
  S.G.E = S.G.E.map(() => null); if (keepEnd) S.G.E[S.G.fens.length - 1] = keepEnd;
  S.R = S.R.map(() => null); S.accuracy = null;
  await analyse();
}

/* ---------- start ---------- */
function askUser(msgHtml) {
  setStatus(errorHTML(msgHtml, `<form id="uForm"><input type="text" id="uIn" placeholder="your chess.com username" spellcheck="false" maxlength="25"><button class="btn primary small" type="submit">Find game</button></form>`));
  $("uForm").addEventListener("submit", async e => {
    e.preventDefault();
    const u = cleanUser($("uIn").value); if (!validUser(u)) return;
    await store.set("username", u); loadFromArchive([u]);
  });
}
async function loadFromArchive(extra) {
  const id = params.get("id");
  const saved = await store.get("username", "");
  const users = [...new Set([...(extra || []), params.get("user"), saved, ...(params.get("hint") || "").split(",")].map(cleanUser).filter(validUser).map(u => u.toLowerCase()))];
  if (!users.length) { askUser("Which chess.com account is this game from? Type your username once and it's remembered."); return; }
  setStatus(`<div class="row"><span class="spin"></span>Finding the game on chess.com…</div>`);
  let res;
  try { res = await findGame(users, id, params.get("month")); }
  catch (e) {
    setStatus(errorHTML(e.kind === "network" ? "Couldn't reach chess.com. Check your internet connection." : e.kind === "busy" ? "chess.com is busy right now." : esc(e.message),
      `<div class="cbtns"><button class="btn ghost small" id="again">Try again</button></div>`));
    $("again").addEventListener("click", () => loadFromArchive(extra)); return;
  }
  if (!res && await loadFromPagePgn(id)) return;
  if (!res) {
    setStatus(errorHTML(`<b>This game isn't in the archive yet.</b> Only <b>finished</b> games can be reviewed, and chess.com can take a minute to add a game that just ended.`,
      `<div class="cbtns"><button class="btn ghost small" id="again">Try again</button></div><div class="muted small">Looked in the games of: ${users.map(esc).join(", ")}</div>`));
    $("again").addEventListener("click", () => loadFromArchive(extra)); return;
  }
  const g = res.game;
  if ((g.rules || "chess") !== "chess") { setStatus(errorHTML("Only standard chess games can be reviewed (not Chess960 or other variants).")); return; }
  const meU = [saved, params.get("user")].map(x => cleanUser(x).toLowerCase());
  S.me = meU.includes(g.white.username.toLowerCase()) ? "w" : meU.includes(g.black.username.toLowerCase()) ? "b" : null;
  setMeta({
    white: { name: g.white.username, rating: g.white.rating }, black: { name: g.black.username, rating: g.black.rating },
    result: resultText(g), tc: (CLASS_NAME[g.time_class] ? CLASS_NAME[g.time_class] + " " : "") + tcLabel(g.time_control), date: dateLabel(g.end_time), url: g.url
  });
  let G;
  try { G = parseGame(g.pgn); } catch (e) { setStatus(errorHTML(esc(e.message))); return; }
  setStatus("");
  startGame(G, "rev:" + id);
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
async function loadFromPgn() {
  const t = await store.get("pendingPgn", "");
  if (!t) { setStatus(errorHTML("No PGN to review. Paste one in the extension's popup.")); return; }
  let G;
  try { G = parseGame(t); } catch (e) { setStatus(errorHTML(esc(e.message))); return; }
  const H = G.H, saved = cleanUser(await store.get("username", "")).toLowerCase();
  S.me = saved && (H.White || "").toLowerCase() === saved ? "w" : saved && (H.Black || "").toLowerCase() === saved ? "b" : null;
  const res = H.Result === "1-0" ? "White won" : H.Result === "0-1" ? "Black won" : H.Result === "1/2-1/2" ? "Draw" : "";
  const cid = /^\d+$/.test(params.get("cid") || "") ? params.get("cid") : null; // a bot game from chess.com
  setMeta({ white: { name: H.White || "White", rating: H.WhiteElo || "" }, black: { name: H.Black || "Black", rating: H.BlackElo || "" },
    result: res, tc: H.TimeControl ? tcLabel(H.TimeControl) : cid ? "vs computer" : "", date: (H.Date || "").replace(/\?+/g, "").replace(/\.$/, ""),
    url: cid ? "https://www.chess.com/game/computer/" + cid : /^https:\/\/(www\.)?chess\.com\//.test(H.Link || "") ? H.Link : null });
  startGame(G, cid ? "rev:computer:" + cid : "rev:pgn:" + hash(t));
}
// a live game that just ended may not be in the archive yet: use the moves the button read from the page
async function loadFromPagePgn(id) {
  const saved = await store.get("pagePgn:" + id, null);
  if (!saved || !saved.pgn) return false;
  let G;
  try { G = parseGame(saved.pgn); } catch (e) { return false; }
  const H = G.H, me = cleanUser(await store.get("username", "")).toLowerCase();
  S.me = me && (H.White || "").toLowerCase() === me ? "w" : me && (H.Black || "").toLowerCase() === me ? "b" : null;
  const res = H.Result === "1-0" ? `${H.White} won` : H.Result === "0-1" ? `${H.Black} won` : "Draw";
  setMeta({ white: { name: H.White || "White", rating: "" }, black: { name: H.Black || "Black", rating: "" }, result: res, tc: "", date: "",
    url: "https://www.chess.com/game/" + (params.get("type") === "daily" ? "daily/" : "live/") + id });
  setStatus("");
  startGame(G, "rev:" + id);
  return true;
}
(async () => {
  drawHeaderBtns(); buildBoard(); drawBoard(); drawEval();
  loadMoveIcons(() => render());
  try { OPEN = await (await fetch("data/openings.json")).json(); } catch (e) { OPEN = {}; }
  try { BOOK = new Uint32Array(await (await fetch("data/book.bin")).arrayBuffer()); } catch (e) { BOOK = new Uint32Array(0); }
  if (params.get("pgn")) loadFromPgn();
  else if (params.get("id") && /^\d+$/.test(params.get("id"))) loadFromArchive([]);
  else setStatus(errorHTML("Open a finished game on chess.com and press <b>Free Review</b>, or pick a game from the extension's toolbar button."));
})();
