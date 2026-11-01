// Adds "Free Review" buttons on chess.com game pages: a floating one (drag it anywhere, it remembers where)
// and one under New Game / Rematch in the game-over box.
// Live and daily games are loaded from chess.com's public archive (finished games only).
// Bot games aren't in the archive, so their moves are read from the page's move list, and ONLY once the
// page shows a result (1-0, 0-1, ½-½): the extension never reads a game that is still being played.
// Finished bot games are remembered so the toolbar popup can list them, and chess.com's game history page
// gets a Free Review button on each bot game.
(() => {
  const USER = /^[A-Za-z0-9_-]{3,25}$/;
  function gameOnPage() {
    const p = location.pathname;
    let m = /^\/(?:analysis\/)?game\/(live|daily|computer)\/(\d+)/.exec(p);
    if (m) return { type: m[1], id: m[2] };
    m = /^\/(?:analysis\/)?game\/(\d+)(?:\/|$)/.exec(p);
    if (m) return { type: "live", id: m[1] };
    m = /^\/(live|daily)\/game\/(\d+)/.exec(p);
    if (m) return { type: m[1], id: m[2] };
    return null;
  }
  // the players: name tags above and below the board, colours from the clocks next to them
  // ({w, b}); falls back to the tab title ("Chess: GM Hikaru vs Sina-Movahed - ..." or "A vs. B Chess Game - ...")
  function sides() {
    const name = where => { const e = document.querySelector(`.player-component.player-${where} .cc-user-username-component, .player-component.player-${where} [data-test-element="user-tagline-username"]`); const t = e ? e.textContent.trim() : ""; return USER.test(t) && !/^(Player|Opponent)$/i.test(t) ? t : null; };
    const top = name("top"), bottom = name("bottom");
    const topIsBlack = !!document.querySelector(".clock-top.clock-black") || !!document.querySelector(".clock-bottom.clock-white");
    if (top && bottom) return topIsBlack ? { w: bottom, b: top } : { w: top, b: bottom };
    const m = /^(?:Chess:\s*)?(.+?)\s+vs\.?\s+(.+?)(?:\s+Chess Game)?\s+-\s/.exec(document.title || "");
    if (!m) return null;
    const clean = s => s.trim().split(/\s+/).pop();
    return { w: clean(m[1]), b: clean(m[2]) };
  }
  function players() { const s = sides(); return s ? [s.w, s.b].filter(x => USER.test(x)) : []; }
  // ratings shown next to the names ({w, b}, "" when there's none: your own rating isn't shown in bot games)
  function ratings() {
    const r = where => { const e = document.querySelector(`.player-component.player-${where} [class*="cc-user-rating"]`); const m = e && /\d{3,4}/.exec(e.textContent); return m ? m[0] : ""; };
    const topIsBlack = !!document.querySelector(".clock-top.clock-black") || !!document.querySelector(".clock-bottom.clock-white");
    return topIsBlack ? { w: r("bottom"), b: r("top") } : { w: r("top"), b: r("bottom") };
  }
  const pgnDate = t => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`; };
  // a bot game opened with the Free Review button on the game history page: {id, when (the date it was
  // played, from the list)}. Passed through storage, because chess.com strips anything added to the address.
  let wanted = null;
  function playedAt() { const g = gameOnPage(); return wanted && g && wanted.id === g.id && wanted.when ? wanted.when : null; }
  // the finished game's result shown on the page, or null while the game is still going
  function resultOnPage() {
    const el = document.querySelector(".game-result");
    const t = el ? el.textContent.replace(/\s/g, "").replace("½-½", "1/2-1/2") : "";
    return /^(1-0|0-1|1\/2-1\/2)$/.test(t) ? t : null;
  }
  // the main line from the move list as a PGN (only for a finished game)
  function pgnFromPage() {
    const res = resultOnPage(); if (!res) return null;
    const sans = [];
    for (const node of document.querySelectorAll(".main-line-row .main-line-ply")) {
      const box = node.querySelector(".node-highlight-content") || node;
      let s = "";
      for (const c of box.childNodes) s += c.nodeType === 3 ? c.textContent : (c.dataset && c.dataset.figurine) || "";
      s = s.replace(/[^KQRBNa-h1-8xO=+#-]/g, "");
      if (s) sans.push(s);
    }
    if (!sans.length) return null;
    const sd = sides() || {}, rt = ratings(), q = s => String(s).replace(/"/g, "");
    const tags = [`[White "${q(sd.w || "White")}"]`, `[Black "${q(sd.b || "Black")}"]`, `[Result "${res}"]`, `[Link "${location.origin + location.pathname}"]`];
    if (rt.w) tags.push(`[WhiteElo "${rt.w}"]`);
    if (rt.b) tags.push(`[BlackElo "${rt.b}"]`);
    if (playedAt()) tags.push(`[Date "${pgnDate(playedAt())}"]`);
    let mv = "";
    sans.forEach((s, i) => { mv += (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + s + " "; });
    return tags.join("\n") + "\n\n" + mv + res;
  }
  // finished bot games are remembered (newest first, up to 60) so the toolbar popup can list them:
  // chess.com's public archive, which the popup uses for other games, has no bot games
  const savedLen = {};
  function saveBotGame() {
    const g = gameOnPage(); if (!g || g.type !== "computer") return;
    const pgn = pgnFromPage(); if (!pgn || (savedLen[g.id] || 0) >= pgn.length) return;
    savedLen[g.id] = pgn.length;
    const sd = sides() || {}, rt = ratings();
    try {
      chrome.storage.local.get("botGames", o => {
        const list = (o && o.botGames) || [], old = list.find(x => x.id === g.id);
        const item = { id: g.id, pgn, w: sd.w || "White", b: sd.b || "Black", wr: rt.w, br: rt.b, res: resultOnPage(), t: playedAt() || (old && old.t) || Date.now() };
        const next = [item].concat(list.filter(x => x.id !== g.id)).sort((a, b) => b.t - a.t).slice(0, 60);
        chrome.storage.local.set({ botGames: next });
      });
    } catch (e) { } // the extension was updated after this page opened
  }
  function openReview(label, replace) {
    const g = gameOnPage(); if (!g) return;
    try {
      const pgn = pgnFromPage();
      if (g.type === "computer") {
        if (!pgn) { label.textContent = "Finish the game first"; setTimeout(() => label.textContent = "Free Review", 2000); return; }
        saveBotGame();
        chrome.storage.local.set({ pendingPgn: pgn }, () => chrome.runtime.sendMessage({ type: "openReview", params: { pgn: "1", cid: g.id }, replace: !!replace }));
        return;
      }
      // live and daily games come from the archive; the page's moves are a backup for a game that just ended
      const go = () => chrome.runtime.sendMessage({ type: "openReview", params: { id: g.id, type: g.type, hint: players().join(",") } });
      if (pgn) chrome.storage.local.set({ ["pagePgn:" + g.id]: { pgn, t: Date.now() } }, go); else go();
    } catch (e) {
      label.textContent = "Reload the page"; // the extension was updated after this page opened
    }
  }
  function makeButton(cls) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = cls;
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("img/magnifier.png"); img.alt = ""; img.draggable = false;
    const label = document.createElement("span"); label.textContent = "Free Review";
    btn.append(img, label);
    return { btn, label };
  }

  /* ---------- floating button ---------- */
  let fab = null, pos = null;
  function place() {
    if (!fab || !pos) return;
    const x = Math.min(Math.max(0, pos.x), innerWidth - fab.offsetWidth), y = Math.min(Math.max(0, pos.y), innerHeight - fab.offsetHeight);
    Object.assign(fab.style, { left: x + "px", top: y + "px", right: "auto", bottom: "auto" });
  }
  function makeFab() {
    const { btn, label } = makeButton("fgr-btn");
    fab = btn;
    btn.title = "Review this game for free (finished games only). Drag to move.";
    let drag = null;
    btn.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const r = btn.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      btn.setPointerCapture(e.pointerId);
    });
    btn.addEventListener("pointermove", e => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moved = true; btn.classList.add("fgr-drag");
      pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy }; place();
    });
    btn.addEventListener("pointerup", () => {
      const d = drag; drag = null; btn.classList.remove("fgr-drag");
      if (d && d.moved) { try { chrome.storage.local.set({ btnPos: pos }); } catch (e) { } return; }
      openReview(label);
    });
    document.documentElement.appendChild(btn);
    try { chrome.storage.local.get("btnPos", o => { if (o && o.btnPos) { pos = o.btnPos; place(); } }); } catch (e) { }
    addEventListener("resize", place);
  }

  /* ---------- button in the game-over box, under New Game / Rematch ---------- */
  function addToGameOverBox() {
    const box = document.querySelector(".game-over-modal-shell-buttons");
    if (!box) return;
    let btn = box.querySelector(".fgr-modal-btn");
    if (!btn) {
      const made = makeButton("fgr-modal-btn"); btn = made.btn;
      btn.title = "Review this game for free with Free Game Review";
      btn.addEventListener("click", () => openReview(made.label));
      box.appendChild(btn);
    }
    // look like chess.com's own Game Review button: borrow its button classes (the page's CSS does the styling)
    const gr = [...box.querySelectorAll("a,button")].find(b => b !== btn && /Game Review/i.test(b.textContent));
    if (gr) {
      const cc = [...gr.classList].filter(c => /^cc-button-/.test(c));
      if (cc.length && !btn.classList.contains("fgr-cc")) btn.classList.add("fgr-cc", ...cc);
    }
    // same width and position as the New Game / Rematch row above it
    const row = box.querySelector(".game-over-secondary-actions-row-component");
    if (row) {
      const rr = row.getBoundingClientRect(), br = box.getBoundingClientRect();
      if (rr.width) { btn.style.width = rr.width + "px"; btn.style.marginLeft = (rr.left - br.left) + "px"; }
    }
  }

  /* ---------- game history page: a Free Review button on every bot game ---------- */
  // It opens the game's page, which (told through storage) reads the finished game's moves and turns into the review.
  function addToHistoryRows() {
    if (!/^\/games\/archive\b/.test(location.pathname)) return;
    for (const row of document.querySelectorAll(".game-history-games-row")) {
      if (row.querySelector(".fgr-row-btn")) continue;
      const a = row.querySelector('a[href*="/game/computer/"]');
      const m = a && /\/game\/computer\/(\d+)/.exec(a.getAttribute("href"));
      if (!m) continue;
      const cell = row.querySelector(".game-history-games-accuracy-cell") || row;
      const made = makeButton("fgr-row-btn");
      made.btn.title = "Review this bot game for free with Free Game Review";
      const theirs = cell.querySelector("a[class*='cc-button-']"); // look like chess.com's own Review button
      if (theirs) made.btn.classList.add("fgr-cc", ...[...theirs.classList].filter(c => /^cc-button-/.test(c)));
      // the date shown in the row ("Nov 1, 2026"), so the popup lists the game under the day it was played
      const dateEl = [...row.querySelectorAll("div, span")].find(e => !e.children.length && /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(e.textContent.trim()));
      const when = dateEl ? Date.parse(dateEl.textContent.trim()) : NaN;
      made.btn.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation();
        const go = () => window.open(`${location.origin}/game/computer/${m[1]}`, "_blank", "noopener");
        try { chrome.storage.local.set({ autoReview: { id: m[1], when: isNaN(when) ? null : when, at: Date.now() } }, go); }
        catch (er) { made.label.textContent = "Reload the page"; } // the extension was updated after this page opened
      });
      cell.appendChild(made.btn);
    }
  }

  let autoDone = false, autoLast = null;
  const asked = {};
  // was this bot game opened from the game history page to be reviewed? (asked once per game, within 2 minutes)
  function checkWanted(g) {
    if (asked[g.id]) return;
    asked[g.id] = true;
    try {
      chrome.storage.local.get("autoReview", o => {
        const a = o && o.autoReview;
        if (a && a.id === g.id && Date.now() - a.at < 120000) { wanted = a; chrome.storage.local.remove("autoReview"); }
      });
    } catch (e) { }
  }
  function tick() {
    const g = gameOnPage();
    // a bot game can only be reviewed once it's over, so its floating button waits for the result
    const show = !!g && (g.type !== "computer" || !!resultOnPage());
    if (show) { if (!fab) makeFab(); fab.style.display = ""; }
    else if (fab) fab.style.display = "none";
    if (g) addToGameOverBox();
    if (g && g.type === "computer") {
      checkWanted(g);
      saveBotGame();
      // opened from the game history page: once the finished game's moves and players have loaded (the same
      // for two checks in a row), show the review in this tab (openReview saves the game too)
      if (!autoDone && wanted && wanted.id === g.id) {
        const p = pgnFromPage();
        if (p && p === autoLast) { autoDone = true; openReview({ textContent: "" }, true); }
        autoLast = p;
      }
    }
    addToHistoryRows();
  }
  tick();
  setInterval(tick, 1000); // chess.com changes pages without reloading
})();
