"use strict";
/* Stockfish 18 (lite, single-threaded WebAssembly build by nmrugg, GPLv3), running in web workers.
   A pool of a few engines analyses the game's positions side by side; one extra engine answers
   the board you are exploring. */
const ENGINE_URL = "engine/stockfish-18-lite-single.js";

class Engine {
  constructor() { this.w = null; this.job = null; this.dead = false; this.busy = false; this.ready = this.init(); this.ready.catch(() => {}); }
  init() {
    return new Promise((res, rej) => {
      let w;
      try { w = new Worker(ENGINE_URL); } catch (e) { this.dead = true; return rej(e); }
      this.w = w;
      let stage = 0;
      const to = setTimeout(() => { this.dead = true; rej(new Error("The chess engine didn't start.")); }, 30000);
      w.onmessage = e => {
        const s = String(e.data);
        if (stage === 0 && s.startsWith("uciok")) {
          stage = 1;
          w.postMessage("setoption name Hash value 32");
          w.postMessage("isready");
        } else if (stage === 1 && s.startsWith("readyok")) {
          stage = 2; clearTimeout(to);
          w.onmessage = ev => this.line(String(ev.data));
          res(this);
        }
      };
      w.onerror = () => { clearTimeout(to); this.dead = true; this.fail(); rej(new Error("The chess engine failed to load.")); };
      w.postMessage("uci");
    });
  }
  line(s) {
    const j = this.job; if (!j) return;
    if (s.startsWith("info ") && s.includes(" pv ")) {
      const t = s.split(" ");
      let depth = 0, mpv = 1, kind = null, val = 0, bound = false, pvAt = -1;
      for (let k = 1; k < t.length; k++) {
        const x = t[k];
        if (x === "depth") depth = +t[++k];
        else if (x === "multipv") mpv = +t[++k];
        else if (x === "score") { kind = t[++k]; val = +t[++k]; }
        else if (x === "lowerbound" || x === "upperbound") bound = true;
        else if (x === "pv") { pvAt = k + 1; break; }
      }
      if (!kind || bound || pvAt < 0) return;
      j.lines[mpv - 1] = { depth, cp: kind === "cp" ? val : null, mate: kind === "mate" ? val : null, pv: t.slice(pvAt) };
      if (j.onInfo && mpv === 1) j.onInfo(j.lines);
    } else if (s.startsWith("bestmove")) {
      this.job = null; clearTimeout(j.timer);
      j.res({ best: s.split(" ")[1], lines: j.lines.filter(Boolean) });
    }
  }
  // scores are from the side to move: cp in centipawns, or mate in N (negative = getting mated)
  run(fen, { depth = 16, ms = 4000, multipv = 2, onInfo = null } = {}) {
    return this.ready.then(() => new Promise((res, rej) => {
      if (this.dead) return rej(new Error("engine"));
      if (this.job) return rej(new Error("busy"));
      const j = this.job = { res, rej, lines: [], onInfo };
      j.timer = setTimeout(() => this.w.postMessage("stop"), ms + 4000);
      this.w.postMessage("setoption name MultiPV value " + multipv);
      this.w.postMessage("position fen " + fen);
      this.w.postMessage("go depth " + depth + " movetime " + ms);
    }));
  }
  stop() { if (this.job && this.w) this.w.postMessage("stop"); }
  fail() { const j = this.job; this.job = null; if (j) { clearTimeout(j.timer); j.rej(new Error("engine")); } }
  kill() { try { this.w && this.w.terminate(); } catch (e) { } this.dead = true; this.fail(); }
}

class EnginePool {
  constructor(n) { this.engines = Array.from({ length: n }, () => new Engine()); this.queue = []; }
  get size() { return this.engines.filter(e => !e.dead).length; }
  run(fen, opts) { return new Promise((res, rej) => { this.queue.push({ fen, opts, res, rej }); this.pump(); }); }
  pump() {
    if (!this.engines.some(e => !e.dead)) { const q = this.queue; this.queue = []; q.forEach(x => x.rej(new Error("The chess engine failed to load."))); return; }
    for (const e of this.engines) {
      if (!this.queue.length) break;
      if (e.busy || e.dead) continue;
      const q = this.queue.shift(); e.busy = true;
      e.run(q.fen, q.opts).then(r => { e.busy = false; q.res(r); this.pump(); },
        err => { e.busy = false; if (e.dead) { this.queue.unshift(q); this.pump(); } else { q.rej(err); this.pump(); } });
    }
  }
  cancel() { const q = this.queue; this.queue = []; q.forEach(x => x.rej(new Error("cancelled"))); this.engines.forEach(e => e.stop()); }
}
const poolSize = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
