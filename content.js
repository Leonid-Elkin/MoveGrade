// MoveGrade content script (lichess.org + chess.com).
//
// Responsibilities:
//   1. Work out what kind of page this is and whether grading is allowed
//      (never during a live game against a human -- that's engine assistance).
//   2. Scrape the mainline move list (SAN) up to the currently selected move.
//   3. Mount the overlay iframe and push it move-list updates.
//
// Both sites obfuscate or frequently change their markup, so the scraper is
// structural rather than selector-based: it finds the element that contains
// the most SAN-looking leaf nodes and treats that as the move list.
// All chess/engine logic lives in the overlay page.

(() => {
  if (window.__movegradeLoaded) return;
  window.__movegradeLoaded = true;

  const SITE = /chess\.com$/.test(location.hostname) ? "chesscom" : "lichess";
  const SAN_RE = /^(?:[NBRQK][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8](?:=[NBRQ])?|O-O(?:-O)?)[+#]?$/;
  const VARIATION_SEL = "interrupt, line, lines, comment, .variation, .sub-line, .sub-variation, .variation-component";
  const ACTIVE_SEL = ".a1t, .active, .selected, .current, .node-highlight-content.selected";
  const FIGURINE = { "♔": "K", "♕": "Q", "♖": "R", "♗": "B", "♘": "N", "♙": "" };

  // Lets the panel page be opened directly (for debugging) without knowing the extension id.
  document.documentElement.dataset.movegradeUrl = chrome.runtime.getURL("overlay/overlay.html");

  let frame = null;
  let visible = true;
  let lastGrade = null;
  let engineStatus = "";
  let lastPayload = "";
  let pos = { left: 12, top: 12 };

  // ---------------------------------------------------------------- board badge
  const CAT_COLORS = {
    brilliant: "#26c2a3", great: "#5c8bb0", best: "#81b64c", excellent: "#96bc4b",
    good: "#95b776", book: "#a88865", inaccuracy: "#f7c631", mistake: "#ffa459",
    blunder: "#fa412d", mate: "#e8e8e8", none: "#4a4744",
  };
  const DARK_TEXT = new Set(["inaccuracy", "mate"]);
  let badge = null;

  /** The site's 8x8 board element and which colour sits at the bottom. */
  function findBoard() {
    if (SITE === "chesscom") {
      const b = document.querySelector("wc-chess-board, chess-board");
      if (!b) return null;
      return { el: b, flipped: b.classList.contains("flipped") };
    }
    const b = document.querySelector(".round__app cg-board, .analyse__board cg-board, .main-board cg-board, cg-board");
    if (!b) return null;
    const wrap = b.closest(".cg-wrap");
    return { el: b, flipped: !!(wrap && wrap.classList.contains("orientation-black")) };
  }

  /**
   * Screen rectangle of a square ("e4"). Prefers the site's own square-bound
   * elements (exact), falling back to dividing the board box by 8.
   */
  function squareRect(sqName) {
    const file = sqName.charCodeAt(0) - 97;
    const rank = +sqName[1];
    const board = findBoard();
    if (!board) return null;

    if (SITE === "chesscom") {
      // chess.com tags pieces and highlights with square-<file><rank>, 1-based
      const el = board.el.querySelector(`.piece.square-${file + 1}${rank}, .highlight.square-${file + 1}${rank}`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 5) return r;
      }
    }

    const r = board.el.getBoundingClientRect();
    if (r.width < 50) return null;
    const sq = r.width / 8;
    const col = board.flipped ? 7 - file : file;
    const row = board.flipped ? rank - 1 : 8 - rank;
    const calc = { left: r.left + col * sq, top: r.top + row * sq, width: sq, height: sq };
    calc.right = calc.left + sq;
    calc.bottom = calc.top + sq;

    if (SITE === "lichess") {
      // lichess draws <square class="last-move"> under both squares of the last
      // move; snap to whichever one our computed square overlaps.
      let best = null, bestDist = Infinity;
      for (const s of board.el.querySelectorAll("square.last-move")) {
        const sr = s.getBoundingClientRect();
        const d = Math.hypot(sr.left + sr.width / 2 - (calc.left + sq / 2), sr.top + sr.height / 2 - (calc.top + sq / 2));
        if (d < bestDist) { bestDist = d; best = sr; }
      }
      if (best && bestDist < sq * 0.6) return best;
    }
    return calc;
  }

  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement("div");
    badge.id = "movegrade-badge";
    Object.assign(badge.style, {
      position: "fixed", display: "none", zIndex: "2147483646", pointerEvents: "none",
      borderRadius: "50%", color: "#fff", fontWeight: "900", textAlign: "center",
      fontFamily: "system-ui, Segoe UI, Roboto, sans-serif",
      boxShadow: "0 1px 4px rgba(0,0,0,0.6)", textShadow: "0 1px 2px rgba(0,0,0,0.4)",
      transition: "background 0.15s",
    });
    document.documentElement.appendChild(badge);
    return badge;
  }

  function positionBadge() {
    const b = ensureBadge();
    if (!lastGrade || !lastGrade.cat) { b.style.display = "none"; return; }
    const sqRect = squareRect(lastGrade.to);
    if (!sqRect) { b.style.display = "none"; return; }
    const size = Math.max(18, Math.min(34, sqRect.width * 0.42));
    Object.assign(b.style, {
      display: "",
      width: size + "px", height: size + "px", lineHeight: size + "px",
      fontSize: Math.round(size * 0.55) + "px",
      // overlap the square's top-right corner
      left: sqRect.right - size * 0.62 + "px",
      top: sqRect.top - size * 0.38 + "px",
      background: CAT_COLORS[lastGrade.cat] || CAT_COLORS.none,
      color: DARK_TEXT.has(lastGrade.cat) ? "#222" : "#fff",
      opacity: lastGrade.provisional ? "0.8" : "1",
    });
    b.textContent = lastGrade.glyph;
    b.title = `${lastGrade.label} (${lastGrade.evalAfter})`;
  }
  window.addEventListener("resize", positionBadge);
  window.addEventListener("scroll", positionBadge, true);
  setInterval(positionBadge, 500);

  // ---------------------------------------------------------------- context
  function detectLichess() {
    const round = document.querySelector(".round__app");
    const analyse = document.querySelector(".analyse__moves, .tview2, .study__multiboard");
    if (round) {
      const finished = !!round.querySelector(".result, .result-wrap, .status");
      const playing =
        document.body.classList.contains("playing") ||
        !!round.querySelector(".rcontrols .ricons");
      const names = [...round.querySelectorAll(".ruser")].map((e) => e.textContent || "");
      const vsEngine = names.some((t) => /stockfish|level\s*\d|\bBOT\b/i.test(t));
      if (playing && !finished && !vsEngine) {
        return { mode: "round", allowed: false, reason: "Paused: live game vs human", root: round };
      }
      return { mode: "round", allowed: true, reason: "", root: round };
    }
    if (analyse) return { mode: "analysis", allowed: true, reason: "", root: analyse.closest("main") || analyse.parentElement || analyse };
    return { mode: "none", allowed: false, reason: "" };
  }

  function detectChesscom() {
    const path = location.pathname;
    const board = document.querySelector("wc-chess-board, chess-board, .board");
    if (!board) return { mode: "none", allowed: false, reason: "" };
    // The dedicated move-list element keeps chess.com's own engine lines
    // (which also contain SAN) out of the scrape.
    const root =
      document.querySelector("wc-move-list, wc-simple-move-list, .move-list, [class*='move-list-component']") ||
      document.querySelector(".board-layout-sidebar, .sidebar-component, #board-layout-sidebar") ||
      document.body;

    const vsComputer = /\/play\/computer/.test(path);
    const isLive = /\/(play\/online|game\/live|live)/.test(path) || /\/game\/\d+/.test(path);
    const finished = !!document.querySelector(".game-over-modal-content, .game-result, .game-over-header-component, [class*='game-over']");
    // Resign/draw controls are only rendered for a participant in a running game.
    const playing = !!document.querySelector(
      ".resign-button-component, button[aria-label='Resign'], [data-cy='resign'], .live-game-buttons-component, .game-controls-component .resign"
    );
    if (isLive && playing && !finished && !vsComputer) {
      return { mode: "round", allowed: false, reason: "Paused: live game vs human", root };
    }
    const mode = /\/analysis|\/events|\/watch/.test(path) ? "analysis" : "round";
    return { mode, allowed: true, reason: "", root };
  }

  const detectContext = SITE === "chesscom" ? detectChesscom : detectLichess;

  // ---------------------------------------------------------------- scraping
  function cleanSan(text) {
    return (text || "")
      .trim()
      .replace(/^\d+\.+\s*/, "")
      .replace(/[♔♕♖♗♘♙]/g, (c) => FIGURINE[c])
      .replace(/[!?□⌓∞±∓⩲⩱⨀→↑⇆⇔]/g, "")
      .replace(/[^\w=+#O-]/g, "")
      .trim();
  }

  function elSan(el) {
    const sanEl = el.querySelector("san");
    if (sanEl) return cleanSan(sanEl.textContent);
    const fig = el.querySelector("[data-figurine]");
    const prefix = fig ? fig.dataset.figurine || "" : "";
    return cleanSan(prefix + el.textContent);
  }

  function isSanEl(el) {
    if (!SAN_RE.test(elSan(el))) return false;
    // deepest match only: no child should itself be a SAN element
    for (const c of el.children) if (SAN_RE.test(elSan(c))) return false;
    return true;
  }

  /** Find the element that contains the most SAN nodes; return its SAN nodes in order. */
  function findMoveNodes(root) {
    const all = root.querySelectorAll("*");
    const candidates = [];
    for (const el of all) {
      if (el.children.length > 3) continue;
      if (el.closest(VARIATION_SEL)) continue;
      if (isSanEl(el)) candidates.push(el);
    }
    if (candidates.length < 2) return candidates.length ? candidates : [];

    const counts = new Map();
    for (const el of candidates) {
      let a = el.parentElement;
      for (let i = 0; i < 6 && a && a !== root.parentElement; i++, a = a.parentElement) {
        counts.set(a, (counts.get(a) || 0) + 1);
      }
    }
    let best = null, bestCount = 0;
    for (const [el, c] of counts) {
      // prefer the highest count; on ties prefer the deeper (inner) element
      if (c > bestCount || (c === bestCount && best && best.contains(el))) {
        best = el;
        bestCount = c;
      }
    }
    return candidates.filter((el) => best.contains(el));
  }

  function scrapeMoves(ctx) {
    const nodes = findMoveNodes(ctx.root || document.body);
    const sans = [];
    let activeIndex = -1;
    for (const el of nodes) {
      const san = elSan(el);
      if (!SAN_RE.test(san)) continue;
      let a = el;
      for (let i = 0; i < 3 && a; i++, a = a.parentElement) {
        if (a.matches(ACTIVE_SEL)) { activeIndex = sans.length; break; }
      }
      sans.push(san);
    }
    // In analysis the user can step back through the game; grade the move
    // they are currently looking at rather than the last one in the list.
    const cut = activeIndex >= 0 ? activeIndex + 1 : sans.length;
    return sans.slice(0, cut);
  }

  // ---------------------------------------------------------------- overlay
  function mountFrame() {
    if (frame) return frame;
    frame = document.createElement("iframe");
    frame.id = "movegrade-frame";
    frame.src = chrome.runtime.getURL("overlay/overlay.html");
    Object.assign(frame.style, {
      position: "fixed",
      top: pos.top + "px",
      left: pos.left + "px",
      width: "440px",
      height: "280px",
      border: "0",
      zIndex: "2147483647",
      background: "transparent",
      colorScheme: "normal",
      pointerEvents: "auto",
    });
    document.documentElement.appendChild(frame);
    chrome.storage.local.get("overlayPosTL", (v) => {
      if (v.overlayPosTL) {
        pos = v.overlayPosTL;
        frame.style.top = pos.top + "px";
        frame.style.left = pos.left + "px";
      }
    });
    return frame;
  }

  function post(msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, "*");
  }

  function update() {
    const ctx = detectContext();
    if (ctx.mode === "none") {
      if (frame) frame.style.display = "none";
      if (badge) badge.style.display = "none";
      return;
    }
    mountFrame();
    frame.style.display = visible ? "" : "none";
    let sans = [];
    try { sans = ctx.allowed ? scrapeMoves(ctx) : []; } catch (e) { console.warn("[MoveGrade] scrape failed", e); }
    const board = findBoard();
    const flipped = !!(board && board.flipped);
    const payload = JSON.stringify({ mode: ctx.mode, allowed: ctx.allowed, reason: ctx.reason, sans, flipped });
    if (payload === lastPayload) return;
    lastPayload = payload;
    post({ type: "movegrade:moves", ...JSON.parse(payload) });
  }

  // ---------------------------------------------------------------- wiring
  let timer = null;
  const observer = new MutationObserver((muts) => {
    // ignore mutations we cause ourselves (the iframe)
    const ours = (n) => n === frame || n === badge;
    if (muts.every((m) => ours(m.target) || (m.target === document.documentElement && [...m.addedNodes].every(ours)))) return;
    clearTimeout(timer);
    timer = setTimeout(update, 150);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "movegrade:ready") {
      lastPayload = "";
      update();
    } else if (d.type === "movegrade:drag" && frame) {
      pos.left = Math.max(0, Math.min(window.innerWidth - 80, pos.left + d.dx));
      pos.top = Math.max(0, Math.min(window.innerHeight - 40, pos.top + d.dy));
      frame.style.top = pos.top + "px";
      frame.style.left = pos.left + "px";
    } else if (d.type === "movegrade:dragend") {
      chrome.storage.local.set({ overlayPosTL: pos });
    } else if (d.type === "movegrade:resize" && frame) {
      frame.style.height = Math.max(120, d.height) + "px";
    } else if (d.type === "movegrade:hide") {
      visible = false;
      if (frame) frame.style.display = "none";
    } else if (d.type === "movegrade:status") {
      engineStatus = d.status || "";
    } else if (d.type === "movegrade:grade") {
      lastGrade = d.cat ? d : null;
      positionBadge();
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "movegrade:toggle") {
      visible = !visible;
      update();
    }
  });

  update();
  // SPA navigations (both sites) don't reload the page.
  setInterval(update, 2000);
})();
