"use strict";
/* Toolbar popup: pick one of your recent finished games, or paste a PGN. */
function openReview(params) {
  const url = "review.html?" + new URLSearchParams(params).toString();
  if (HAS_CHROME && chrome.tabs) { chrome.tabs.create({ url: chrome.runtime.getURL(url) }); window.close(); }
  else location.href = url;
}
function msg(t, bad) { const m = $("msg"); m.hidden = !t; m.innerHTML = t || ""; m.classList.toggle("bad", !!bad); }

async function showGames(user) {
  const list = $("games");
  list.innerHTML = "";
  msg("Loading your games…");
  let games;
  try { games = await recentGames(user, 30); }
  catch (e) {
    msg(e.kind === "notfound" ? `There's no chess.com player called <b>${esc(user)}</b>.` :
      e.kind === "network" ? "Couldn't reach chess.com. Check your internet connection." :
        e.kind === "busy" ? "chess.com is busy. Try again in a few seconds." : esc(e.message), true);
    return;
  }
  const std = games.filter(g => (g.rules || "chess") === "chess");
  if (!std.length) { msg("No finished games in the last few months."); return; }
  msg("");
  const lu = user.toLowerCase();
  for (const g of std) {
    const color = g.white.username.toLowerCase() === lu ? "w" : "b";
    const opp = color === "w" ? g.black : g.white, res = resultFor(g, color);
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button"; b.className = "game";
    b.innerHTML = `<span class="res ${res}">${res === "win" ? "Won" : res === "loss" ? "Lost" : "Draw"}</span>` +
      `<span class="who"><b><span class="side ${color}" title="You played ${color === "w" ? "White" : "Black"}"></span>vs ${esc(opp.username)} (${esc(opp.rating)})</b>` +
      `<span>${esc(CLASS_NAME[g.time_class] || g.time_class || "")} · ${esc(tcLabel(g.time_control))} · ${esc(dateLabel(g.end_time))}</span></span>` +
      `<span class="go">Review ›</span>`;
    b.addEventListener("click", () => {
      const d = new Date((g.end_time || 0) * 1000);
      openReview({ id: gameIdOf(g), user, month: d.getUTCFullYear() + "/" + String(d.getUTCMonth() + 1).padStart(2, "0") });
    });
    li.appendChild(b); list.appendChild(li);
  }
}

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
