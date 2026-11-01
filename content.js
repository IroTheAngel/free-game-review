// Adds "Free Review" buttons on chess.com game pages: a floating one (drag it anywhere, it remembers where)
// and one under New Game / Rematch in the game-over box.
// Live and daily games are loaded from chess.com's public archive (finished games only).
// Bot games aren't in the archive, so their moves are read from the page's move list, and ONLY once the
// page shows a result (1-0, 0-1, ½-½): the extension never reads a game that is still being played.
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
    const sd = sides() || {};
    const tags = [`[White "${(sd.w || "White").replace(/"/g, "")}"]`, `[Black "${(sd.b || "Black").replace(/"/g, "")}"]`, `[Result "${res}"]`, `[Link "${location.origin + location.pathname}"]`];
    let mv = "";
    sans.forEach((s, i) => { mv += (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + s + " "; });
    return tags.join("\n") + "\n\n" + mv + res;
  }
  function openReview(label) {
    const g = gameOnPage(); if (!g) return;
    try {
      const pgn = pgnFromPage();
      if (g.type === "computer") {
        if (!pgn) { label.textContent = "Finish the game first"; setTimeout(() => label.textContent = "Free Review", 2000); return; }
        chrome.storage.local.set({ pendingPgn: pgn }, () => chrome.runtime.sendMessage({ type: "openReview", params: { pgn: "1", cid: g.id } }));
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

  function tick() {
    const g = gameOnPage();
    // a bot game can only be reviewed once it's over, so its floating button waits for the result
    const show = !!g && (g.type !== "computer" || !!resultOnPage());
    if (show) { if (!fab) makeFab(); fab.style.display = ""; }
    else if (fab) fab.style.display = "none";
    if (g) addToGameOverBox();
  }
  tick();
  setInterval(tick, 1000); // chess.com changes pages without reloading
})();
