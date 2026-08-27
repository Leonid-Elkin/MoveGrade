// Service worker: toolbar toggle + owner of the offscreen engine document.
//
// The Stockfish worker runs in an offscreen document rather than in the panel
// iframe, because lichess/chess.com serve their pages cross-origin isolated
// (COEP require-corp) and Workers started from a frame embedded there fail to
// load. The offscreen page is never embedded in the site, so it is immune.

const OFFSCREEN_URL = "offscreen/engine-host.html";
let creating = null;

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["WORKERS"],
        justification: "Runs the Stockfish WebAssembly engine used to grade moves.",
      })
      .catch((e) => {
        // "already exists" races are fine
        if (!/exists/i.test(String(e))) throw e;
      })
      .finally(() => (creating = null));
  }
  await creating;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "movegrade:ensure-engine") {
    ensureOffscreen().then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ ok: false, error: String(e) })
    );
    return true;
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !/^https:\/\/(lichess\.org|www\.chess\.com)\//.test(tab.url || "")) return;
  chrome.tabs.sendMessage(tab.id, { type: "movegrade:toggle" }).catch(() => {});
});
