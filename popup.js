"use strict";
/* Toolbar popup: pick one of your recent finished games, or paste a PGN. */
function openReview(params) {
  const url = "review.html?" + new URLSearchParams(params).toString();
  if (HAS_CHROME && chrome.tabs) { chrome.tabs.create({ url: chrome.runtime.getURL(url) }); window.close(); }
  else location.href = url;
}
function msg(t, bad) { const m = $("msg"); m.hidden = !t; m.innerHTML = t || ""; m.classList.toggle("bad", !!bad); }

// one row of the list
function gameRow({ res, color, opp, rating, meta, onClick }) {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button"; b.className = "game";
  b.innerHTML = `<span class="res ${res}">${res === "win" ? "Won" : res === "loss" ? "Lost" : "Draw"}</span>` +
    `<span class="who"><b><span class="side ${color}" title="You played ${color === "w" ? "White" : "Black"}"></span>vs ${esc(opp)}${rating ? ` (${esc(rating)})` : ""}</b>` +
    `<span>${esc(meta)}</span></span>` +
    `<span class="go">Review ›</span>`;
  b.addEventListener("click", onClick);
  li.appendChild(b);
  return li;
}

async function showGames(user) {
  const list = $("games");
  list.innerHTML = "";
  $("moreBots").hidden = true;
  msg("Loading your games…");
  const lu = user.toLowerCase(), rows = [];
  // online games from chess.com's public archive
  let err = null;
  try {
    const games = await recentGames(user, 30);
    for (const g of games.filter(g => (g.rules || "chess") === "chess")) {
      const color = g.white.username.toLowerCase() === lu ? "w" : "b";
      const opp = color === "w" ? g.black : g.white;
      rows.push({ t: (g.end_time || 0) * 1000, res: resultFor(g, color), color, opp: opp.username, rating: opp.rating,
        meta: `${CLASS_NAME[g.time_class] || g.time_class || ""} · ${tcLabel(g.time_control)} · ${dateLabel(g.end_time)}`,
        onClick: () => {
          const d = new Date((g.end_time || 0) * 1000);
          openReview({ id: gameIdOf(g), user, month: d.getUTCFullYear() + "/" + String(d.getUTCMonth() + 1).padStart(2, "0") });
        } });
    }
  } catch (e) { err = e; }
  // bot games aren't in that archive: these are the finished ones the extension saw on chess.com
  for (const g of await store.get("botGames", [])) {
    const color = g.w.toLowerCase() === lu ? "w" : g.b.toLowerCase() === lu ? "b" : null;
    if (!color) continue;
    const res = g.res === "1/2-1/2" ? "draw" : (g.res === "1-0") === (color === "w") ? "win" : "loss";
    rows.push({ t: g.t, res, color, opp: color === "w" ? g.b : g.w, rating: color === "w" ? g.br : g.wr, meta: `Bot · ${dateLabel(Math.floor(g.t / 1000))}`,
      onClick: async () => { await store.set("pendingPgn", g.pgn); openReview({ pgn: "1", cid: g.id }); } });
  }
  rows.sort((a, b) => b.t - a.t).slice(0, 40).forEach(r => list.appendChild(gameRow(r)));
  $("moreBots").hidden = !!(err && err.kind === "notfound");
  if (err && !rows.length) {
    msg(err.kind === "notfound" ? `There's no chess.com player called <b>${esc(user)}</b>.` :
      err.kind === "network" ? "Couldn't reach chess.com. Check your internet connection." :
        err.kind === "busy" ? "chess.com is busy. Try again in a few seconds." : esc(err.message), true);
  } else if (!rows.length) msg("No finished games in the last few months.");
  else msg(err ? "Couldn't load your online games right now; showing your bot games." : "", !!err);
}
// older bot games: chess.com's own game history (filtered to bots), where each game gets a Free Review button
$("moreBots").addEventListener("click", async () => {
  const u = cleanUser($("user").value) || await store.get("username", "");
  if (!validUser(u)) return;
  const url = `https://www.chess.com/games/archive/${encodeURIComponent(u)}?gameType=computer`;
  if (HAS_CHROME && chrome.tabs) { chrome.tabs.create({ url }); window.close(); } else window.open(url, "_blank", "noopener");
});

$("userForm").addEventListener("submit", async e => {
  e.preventDefault();
  const u = cleanUser($("user").value);
  if (!validUser(u)) { msg("Type your chess.com username (3 to 25 letters, numbers, _ or -).", true); return; }
  await store.set("username", u);
  showGames(u);
});
$("pgnGo").addEventListener("click", async () => {
  const t = $("pgn").value.trim();
  if (!t) { msg("Paste a PGN first.", true); return; }
  await store.set("pendingPgn", t);
  openReview({ pgn: "1" });
});
(async () => {
  const u = await store.get("username", "");
  if (u) { $("user").value = u; showGames(u); }
  else $("user").focus();
})();
