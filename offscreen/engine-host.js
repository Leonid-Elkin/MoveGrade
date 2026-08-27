// Offscreen document: hosts the single Stockfish worker and serves analysis
// requests from panel iframes over runtime ports.
//
// Port protocol (panel -> host):
//   { type: "analyse", id, fen, depth }
//   { type: "stop" }
// (host -> panel):
//   { type: "ready" } | { type: "error", message }
//   { type: "progress", id, snapshot } | { type: "result", id, result }

import { Engine } from "../overlay/engine.js";

const ports = new Set();
let engineError = null;
let engine = null;

function startEngine(nnue) {
  const e = new Engine(chrome.runtime.getURL("engine/stockfish-nnue-16-single.js"), {
    nnue,
    onError: (msg) => {
      if (e !== engine) return;
      if (nnue) {
        // Most likely the 40 MB net failed to load; classical eval still grades fine.
        console.warn("[engine] NNUE start failed, retrying without NNUE:", msg);
        e.terminate();
        startEngine(false);
        return;
      }
      engineError = msg;
      for (const p of ports) safePost(p, { type: "error", message: msg });
    },
    onLog: (line) => console.debug("[engine]", line),
  });
  engine = e;
  e.readyPromise.then(
    () => { if (e === engine) for (const p of ports) safePost(p, { type: "ready" }); },
    () => {}
  );
}
startEngine(true);

function safePost(port, msg) {
  try { port.postMessage(msg); } catch { ports.delete(port); }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "movegrade-engine") return;
  ports.add(port);
  if (engineError) safePost(port, { type: "error", message: engineError });
  else if (engine.ready) safePost(port, { type: "ready" });

  port.onMessage.addListener(async (msg) => {
    if (!msg) return;
    if (msg.type === "stop") { engine.stop(); return; }
    if (msg.type === "analyse") {
      // wait for whichever engine instance ends up ready (NNUE or fallback)
      while (engine && !engine.ready && !engineError) {
        try { await engine.readyPromise; } catch { await new Promise((r) => setTimeout(r, 200)); }
      }
      if (!engine || engineError) { safePost(port, { type: "result", id: msg.id, result: null }); return; }
      const result = await engine.analyse(msg.fen, msg.depth, (snapshot) =>
        safePost(port, { type: "progress", id: msg.id, snapshot })
      );
      safePost(port, { type: "result", id: msg.id, result });
    }
  });
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (!ports.size) engine.stop();
  });
});
