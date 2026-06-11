// Compatibility sweep: loads each script, sends one enc turn, counts screen frames.
// Waits for the matron "ready" handshake before loading, to survive respawn cycles.
import { WebSocket } from "ws";

const scripts = JSON.parse(await (await fetch("http://localhost:5151/api/scripts")).text());

function test(path, timeoutMs = 1200) {
  return new Promise((res) => {
    const ws = new WebSocket("ws://localhost:5151/ws");
    let frames = 0, err = null, meta = null, ready = false;
    const tid = setTimeout(() => { ws.close(); res({ path, frames, err, meta }); }, timeoutMs);
    ws.on("open", () => {});
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if ((m.t === "hello" || m.t === "ready") && !ready) {
        ready = true;
        ws.send(JSON.stringify({ t: "load", path }));
        setTimeout(() => ws.send(JSON.stringify({ t: "enc", n: 2, d: 3 })), 300);
      }
      if (m.t === "frame") frames++;
      else if (m.t === "meta") meta = m.name;
      else if (m.t === "log" && m.level === "error" && !err) err = m.msg.split("\n")[0];
    });
    ws.on("error", () => { clearTimeout(tid); res({ path, frames, err: "wserr", meta }); });
    ws.on("close", () => clearTimeout(tid));
  });
}

async function pause(ms = 150) { return new Promise(r => setTimeout(r, ms)); }

let ok = 0;
for (const s of scripts) {
  const r = await test(s.path);
  const status = r.frames > 0 ? "OK " : (r.err ? "ERR" : "-- ");
  if (r.frames > 0) ok++;
  console.log(`${status} ${s.rel.padEnd(45)} f=${r.frames}${r.err ? " | " + r.err.slice(0, 80) : ""}`);
  await pause();
}
console.log(`\n=== ${ok}/${scripts.length} scripts rendered at least one frame ===`);
process.exit(0);
