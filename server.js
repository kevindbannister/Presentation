const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocket, WebSocketServer } = require("ws");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 5175);
const ROOT = path.join(__dirname, "public");
const clients = new Map();
let obs = null;
let obsReady = false;
let obsPassword = "";
let requestCounter = 0;
const pending = new Map();

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" })[ext] || "application/octet-stream";
}

function broadcast(message, role) {
  const data = JSON.stringify(message);
  for (const [socket, clientRole] of clients.entries()) {
    if (socket.readyState === WebSocket.OPEN && (!role || role === clientRole)) socket.send(data);
  }
}

function safeEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function obsAuth(password, salt, challenge) {
  const secret = crypto.createHash("sha256").update(password + salt).digest("base64");
  return crypto.createHash("sha256").update(secret + challenge).digest("base64");
}

function obsCall(requestType, requestData) {
  if (!obs || !obsReady || obs.readyState !== WebSocket.OPEN) return Promise.reject(new Error("OBS is not connected"));
  const requestId = "presentation-" + (++requestCounter);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("OBS request timed out: " + requestType));
    }, 5000);
    pending.set(requestId, { resolve, reject, timer });
    obs.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } }));
  });
}

function closeObs() {
  obsReady = false;
  if (obs) {
    try { obs.close(); } catch (_) {}
    obs = null;
  }
  for (const [id, item] of pending.entries()) {
    clearTimeout(item.timer);
    item.reject(new Error("OBS connection closed"));
    pending.delete(id);
  }
  broadcast({ type: "obsStatus", connected: false });
}

function connectObs(address, password) {
  return new Promise((resolve, reject) => {
    closeObs();
    const target = new URL(address || "ws://127.0.0.1:4455");
    if (!["ws:", "wss:"].includes(target.protocol)) return reject(new Error("OBS address must use ws:// or wss://"));
    if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname)) return reject(new Error("For safety, this prototype only connects to OBS on this computer."));
    obsPassword = password || "";
    let settled = false;
    obs = new WebSocket(target.toString());
    const socket = obs;
    const fail = (error) => {
      if (!settled) { settled = true; reject(error instanceof Error ? error : new Error(String(error))); }
      broadcast({ type: "obsStatus", connected: false, error: error.message || String(error) });
    };
    const timer = setTimeout(() => fail(new Error("Timed out connecting to OBS. Check its WebSocket settings.")), 7000);
    socket.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (msg.op === 0) {
        const d = msg.d || {};
        const auth = d.authentication ? obsAuth(obsPassword, d.authentication.salt, d.authentication.challenge) : undefined;
        socket.send(JSON.stringify({ op: 1, d: { rpcVersion: d.rpcVersion || 1, eventSubscriptions: 33, ...(auth ? { authentication: auth } : {}) } }));
      } else if (msg.op === 2) {
        obsReady = true;
        clearTimeout(timer);
        if (!settled) { settled = true; resolve(true); }
        broadcast({ type: "obsStatus", connected: true });
      } else if (msg.op === 7) {
        const item = pending.get(msg.d.requestId);
        if (item) {
          clearTimeout(item.timer);
          pending.delete(msg.d.requestId);
          if (msg.d.requestStatus && msg.d.requestStatus.result) item.resolve(msg.d.responseData || {});
          else item.reject(new Error((msg.d.requestStatus && msg.d.requestStatus.comment) || "OBS rejected the request"));
        }
      } else if (msg.op === 5) {
        broadcast({ type: "obsEvent", eventType: msg.d.eventType, eventData: msg.d.eventData });
      }
    });
    socket.on("error", (error) => { clearTimeout(timer); fail(error); });
    socket.on("close", () => {
      clearTimeout(timer);
      if (obs === socket) { obs = null; obsReady = false; broadcast({ type: "obsStatus", connected: false }); }
      if (!settled) fail(new Error("OBS connection closed before authentication completed."));
    });
  });
}

async function runCommands(commands) {
  const results = [];
  for (const raw of commands || []) {
    const line = String(raw).trim();
    let match = line.match(/^#scene\s*:\s*(.+)$/i);
    if (match) {
      await obsCall("SetCurrentProgramScene", { sceneName: match[1].trim() });
      results.push("Scene: " + match[1].trim());
      continue;
    }
    match = line.match(/^#source\.(show|hide)\s*:\s*(.+)$/i);
    if (match) {
      const scene = await obsCall("GetCurrentProgramScene");
      const list = await obsCall("GetSceneItemList", { sceneName: scene.currentProgramSceneName });
      const name = match[2].trim();
      const item = (list.sceneItems || []).find((entry) => entry.sourceName === name);
      if (!item) throw new Error("Source not found in current scene: " + name);
      await obsCall("SetSceneItemEnabled", { sceneName: scene.currentProgramSceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: match[1].toLowerCase() === "show" });
      results.push((match[1].toLowerCase() === "show" ? "Shown: " : "Hidden: ") + name);
      continue;
    }
    if (line.startsWith("#")) throw new Error("Unsupported command: " + line);
  }
  return results;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + HOST + ":" + PORT);
  if (req.method === "GET" && (url.pathname === "/api/health")) return json(res, 200, { ok: true, obsConnected: obsReady });
  if (req.method === "GET" && (url.pathname === "/api/next" || url.pathname === "/api/previous")) {
    broadcast({ type: "navigate", delta: url.pathname.endsWith("/next") ? 1 : -1 }, "control");
    return json(res, 200, { ok: true, action: url.pathname.endsWith("/next") ? "next" : "previous" });
  }
  if (req.method === "POST" && url.pathname === "/api/obs/connect") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 10000) req.destroy(); });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        await connectObs(data.address, data.password);
        json(res, 200, { ok: true, connected: true });
      } catch (error) { json(res, 400, { ok: false, error: error.message }); }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/obs/commands") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 100000) req.destroy(); });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const results = await runCommands(data.commands || []);
        json(res, 200, { ok: true, results });
      } catch (error) { json(res, 400, { ok: false, error: error.message }); }
    });
    return;
  }
  const output = url.pathname === "/output" ? "/index.html" : decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.resolve(ROOT, "." + output);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, "index.html")) return json(res, 403, { error: "Forbidden" });
  fs.readFile(file, (error, data) => {
    if (error) return json(res, 404, { error: "Not found" });
    res.writeHead(200, { "Content-Type": mime(file), "Cache-Control": "no-store" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket, req) => {
  const url = new URL(req.url, "http://" + HOST + ":" + PORT);
  const role = url.searchParams.get("role") === "output" ? "output" : "control";
  clients.set(socket, role);
  socket.send(JSON.stringify({ type: "obsStatus", connected: obsReady }));
  socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch (_) { return; }
    if (role === "control" && message.type === "slideState") broadcast({ type: "slideState", slide: message.slide }, "output");
    if (role === "control" && message.type === "obsStatusRequest") socket.send(JSON.stringify({ type: "obsStatus", connected: obsReady }));
  });
  socket.on("close", () => clients.delete(socket));
});

server.listen(PORT, HOST, () => console.log("Presentation is ready at http://" + HOST + ":" + PORT));
