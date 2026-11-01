"use strict";
/* Shared by the popup and the review page: saved settings, chess.com's public game archive, small helpers. */

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// chrome.storage when running as the extension, localStorage when the page is opened on its own (testing)
const HAS_CHROME = typeof chrome !== "undefined" && !!(chrome.storage && chrome.storage.local);
const store = {
  async get(k, d) {
    try {
      if (HAS_CHROME) { const o = await chrome.storage.local.get(k); return o[k] === undefined ? d : o[k]; }
      const v = localStorage.getItem("fgr:" + k); return v === null ? d : JSON.parse(v);
    } catch (e) { return d; }
  },
  async set(k, v) {
    try { if (HAS_CHROME) await chrome.storage.local.set({ [k]: v }); else localStorage.setItem("fgr:" + k, JSON.stringify(v)); } catch (e) { }
  },
  async remove(k) {
    try { if (HAS_CHROME) await chrome.storage.local.remove(k); else localStorage.removeItem("fgr:" + k); } catch (e) { }
  },
  async all() {
    try {
      if (HAS_CHROME) return await chrome.storage.local.get(null);
      const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("fgr:")) o[k.slice(4)] = JSON.parse(localStorage.getItem(k)); }
      return o;
    } catch (e) { return {}; }
  }
};
// small per-page preferences (theme, sound) that must be ready before the first paint
const prefs = {
  get(k, d) { try { const v = localStorage.getItem("fgr-pref:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("fgr-pref:" + k, JSON.stringify(v)); } catch (e) { } }
};
function applyTheme() { document.documentElement.setAttribute("data-mode", prefs.get("theme", "dark")); }
applyTheme();

/* ---------- chess.com public API (published data, no login) ---------- */
const API = "https://api.chess.com/pub/player/";
class ApiError extends Error { constructor(kind, msg) { super(msg || kind); this.kind = kind; } }
async function getJSON(url) {
  let r;
  try { r = await fetch(url, { cache: "no-cache" }); } catch (e) { throw new ApiError("network"); }
  if (r.status === 404 || r.status === 410) throw new ApiError("notfound");
  if (r.status === 429) throw new ApiError("busy");
  if (!r.ok) throw new ApiError("http", "chess.com answered " + r.status);
  return r.json();
}
const cleanUser = u => String(u || "").trim().replace(/^@/, "");
const validUser = u => /^[A-Za-z0-9_-]{3,25}$/.test(u);
async function archiveList(user) {
  const j = await getJSON(API + encodeURIComponent(user.toLowerCase()) + "/games/archives");
  return j.archives || [];
}
async function monthGames(url) { const j = await getJSON(url); return j.games || []; }
// newest first, up to `want` games from the last few months
async function recentGames(user, want = 30) {
  const a = await archiveList(user);
  let out = [];
  for (let i = a.length - 1; i >= 0 && i >= a.length - 3 && out.length < want; i--) {
    const g = await monthGames(a[i]);
    out = out.concat(g.slice().sort((x, y) => (y.end_time || 0) - (x.end_time || 0)));
  }
  return out.slice(0, want);
}
const gameIdOf = g => { const m = /\/(\d+)\/?$/.exec(g.url || ""); return m ? m[1] : null; };
// look for a finished game by its id in the archives of the given players (one request at a time)
async function findGame(users, id, month) {
  let lastErr = null;
  for (const u of users) {
    let arch;
    try { arch = await archiveList(u); } catch (e) { lastErr = e; continue; }
    const order = [];
    if (month) { const hit = arch.find(a => a.endsWith("/" + month)); if (hit) order.push(hit); }
    for (let i = arch.length - 1; i >= 0 && i >= arch.length - 3; i--) if (!order.includes(arch[i])) order.push(arch[i]);
    for (const url of order) {
      let games;
      try { games = await monthGames(url); } catch (e) { lastErr = e; continue; }
      const g = games.find(x => gameIdOf(x) === String(id));
      if (g) return { game: g, user: u };
    }
  }
  if (lastErr && lastErr.kind !== "notfound") throw lastErr;
  return null;
}
const DRAWS = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);
function resultFor(g, color) {
  const r = g[color === "w" ? "white" : "black"].result;
  return r === "win" ? "win" : DRAWS.has(r) ? "draw" : "loss";
}
const HOW = { checkmated: "checkmate", resigned: "resignation", timeout: "time", abandoned: "abandonment", agreed: "agreement", repetition: "repetition",
  stalemate: "stalemate", insufficient: "insufficient material", "50move": "the 50-move rule", timevsinsufficient: "time vs insufficient material" };
function resultText(g) {
  const w = g.white.result, b = g.black.result;
  if (w === "win") return `${g.white.username} won by ${HOW[b] || b}`;
  if (b === "win") return `${g.black.username} won by ${HOW[w] || w}`;
  return `Draw by ${HOW[w] || w}`;
}
function tcLabel(tc) {
  if (!tc) return "";
  if (tc.includes("/")) { const d = +tc.split("/")[1]; const n = Math.round(d / 86400); return n + " day" + (n > 1 ? "s" : ""); }
  const [b, inc] = tc.split("+").map(Number);
  const m = b / 60, base = m >= 1 ? String(Number.isInteger(m) ? m : +m.toFixed(1)) : b + "s";
  return inc ? base + "+" + inc : base + " min";
}
const CLASS_NAME = { bullet: "Bullet", blitz: "Blitz", rapid: "Rapid", daily: "Daily", classical: "Classical" };
function dateLabel(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000), now = new Date();
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}
