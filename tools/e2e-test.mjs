// Tiny end-to-end test: connect to the running emulator over WebSocket,
// load a script, send an encoder turn, and report the screen frames + logs.
// Usage: node tools/e2e-test.mjs [/scripts/examples/hello/hello.lua]
import { WebSocket } from "ws";

const PATH = process.argv[2] || "/scripts/examples/hello/hello.lua";
const ws = new WebSocket("ws://localhost:5151/ws");
let frames = 0, lastOps = 0;
const logs = [];

const done = (code) => {
  console.log(`frames=${frames} lastOps=${lastOps}`);
  console.log("logs:\n" + logs.join("\n"));
  process.exit(code);
};

ws.on("open", () => {
  ws.send(JSON.stringify({ t: "load", path: PATH }));
  setTimeout(() => ws.send(JSON.stringify({ t: "enc", n: 2, d: 10 })), 300);
  setTimeout(() => ws.send(JSON.stringify({ t: "key", n: 1, z: 1 })), 500);
  setTimeout(() => done(frames > 0 ? 0 : 1), 1500);
});
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.t === "frame") { frames++; lastOps = m.ops.length; }
  else if (m.t === "log") logs.push(`[${m.level}] ${m.msg}`);
  else if (m.t === "meta") logs.push(`[meta] ${m.name} (${(m.params||[]).length} params)`);
});
ws.on("error", (e) => { console.error("ws error:", e.message); process.exit(2); });
