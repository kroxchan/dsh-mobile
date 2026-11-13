#!/usr/bin/env node
/**
 * DSH 手机网关
 * ------------------------------------------------------------------
 * Cloudflare 隧道（可选） -> 本机 127.0.0.1:19000 -> 本网关
 *
 * 网关做三件事：
 *   1) 一道口令门（krox_gate cookie），挡住公网上的陌生人；
 *   2) 自动发现本机正在运行的 DSH Web GUI（桌面端每次启动端口随机）；
 *   3) 反向代理过去，并注入 DSH 的浏览器会话 cookie、把 Host/Origin 改写成
 *      回环地址，让隧道过来的请求看起来像本机浏览器发出的。
 */
import http from "node:http";
import os from "node:os";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(DIR, "config.json");
const LOG_PATH = path.join(DIR, "gateway.log");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

const UPSTREAM_HOST = "127.0.0.1";
const HINT_PORT = config.upstreamPort ?? 61324;
const LISTEN_PORT = config.listenPort ?? 19000;
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const BRIDGE_DIR = process.env.DSH_REMOTE_DIR || path.join(os.homedir(), ".dsh-remote");
const GATE_COOKIE = "krox_gate";
const GATE_MAX_AGE = 30 * 24 * 3600; // seconds
const DSH_COOKIE_DAYS = 30;
const UPSTREAM_TTL_MS = 30_000;

/* 手机端 IM 原型（纯静态，放在 prototype/，走同一道口令门） */
const PROTO_PREFIX = "/__proto/";
const PROTO_DIR = path.join(DIR, "prototype");
const PROTO_VERSION = "20261113b";
const GUARD_PATH = path.join(DIR, "gateway-guard.js");
const PROTO_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(" ")}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
  process.stdout.write(line);
}

/* ----------------------------- DSH 会话 cookie ----------------------------- */

function readStoredSecretB64() {
  try {
    const raw = fs.readFileSync(path.join(DSH_HOME, ".credentials.yaml"), "utf8");
    const match = raw.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]{40,})/);
    if (match) return match[1];
  } catch {}
  return null;
}

function readBridgeCookie(port) {
  const files = [
    path.join(BRIDGE_DIR, `.harness-cookie.127.0.0.1_${port}.json`),
    path.join(BRIDGE_DIR, ".harness-cookie.json"),
  ];
  for (const file of files) {
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof json.cookie === "string" && json.cookie.length > 0) return json.cookie;
    } catch {}
  }
  return null;
}

const mintedCache = new Map(); // authority -> header

/** 用 $DSH_HOME/.credentials.yaml 里的签名密钥，为某个回环 authority 生成 DSH cookie。 */
function mintCookieFor(authority) {
  const cached = mintedCache.get(authority);
  if (cached !== undefined) return cached;
  const secretB64 = readStoredSecretB64();
  if (secretB64 === null) return null;
  let key;
  try {
    key = Buffer.from(secretB64, "base64url");
  } catch {
    return null;
  }
  if (key.byteLength !== 32) return null;
  const name = "dsh-auth-" + crypto.createHash("sha256").update(authority).digest("base64url");
  const now = Date.now();
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + DSH_COOKIE_DAYS * 86400000 };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(body).digest("base64url");
  const header = `${name}=v1.${body}.${sig}`;
  mintedCache.set(authority, header);
  return header;
}

/* ------------------------- 自动发现 DSH 上游端口 ------------------------- */

let upstream = { port: HINT_PORT, cookie: null, at: 0 };
let resolving = null;

function loopbackListeningPorts() {
  const ports = new Set();
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    for (const line of out.split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+\d+/i);
      if (match === null) continue;
      const address = match[1];
      const port = Number(match[2]);
      if (!Number.isInteger(port) || port <= 0 || port === LISTEN_PORT) continue;
      if (address === "127.0.0.1" || address === "::1" || address === "[::1]") ports.add(port);
    }
  } catch {}
  return [...ports];
}

function probePort(port) {
  return new Promise((resolve) => {
    const authority = `${UPSTREAM_HOST}:${port}`;
    const cookie = mintCookieFor(authority) ?? readBridgeCookie(port);
    if (cookie === null) {
      resolve(null);
      return;
    }
    const req = http.request(
      {
        host: UPSTREAM_HOST,
        port,
        path: "/",
        method: "GET",
        headers: { host: authority, cookie, "user-agent": "dsh-mobile-gateway", "accept-encoding": "identity" },
        timeout: 2500,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          if (body.length < 40000) body += chunk.toString("utf8");
        });
        res.on("end", () => {
          if (res.statusCode === 200 && body.includes("__DSH")) resolve({ port, cookie });
          else resolve(null);
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

async function resolveUpstream() {
  const candidates = [HINT_PORT, ...loopbackListeningPorts()].filter((port, index, list) => Number.isInteger(port) && list.indexOf(port) === index);
  const results = await Promise.all(candidates.slice(0, 40).map((port) => probePort(port)));
  const found = results.find((item) => item !== null);
  if (found === undefined) {
    log("未找到 DSH 上游（桌面端没在运行？）");
    upstream = { port: upstream.port, cookie: null, at: 0 };
    return upstream;
  }
  if (found.port !== upstream.port) log(`上游 = ${UPSTREAM_HOST}:${found.port}`);
  upstream = { port: found.port, cookie: found.cookie, at: Date.now() };
  return upstream;
}

async function ensureUpstream() {
  if (upstream.cookie !== null && Date.now() - upstream.at < UPSTREAM_TTL_MS) return upstream;
  if (resolving === null) {
    resolving = resolveUpstream().finally(() => {
      resolving = null;
    });
  }
  return resolving;
}

function upstreamCookie() {
  if (upstream.cookie !== null) return upstream.cookie;
  const authority = `${UPSTREAM_HOST}:${upstream.port}`;
  const minted = mintCookieFor(authority);
  if (minted !== null) return minted;
  return readBridgeCookie(upstream.port);
}

/* ---------------------- DSH 远程事件：审批 / 选择题 ---------------------- */

const pendingApprovals = new Map();
const pendingQuestions = new Map();
let eventSocket = null;
let eventClientId = null;
let eventBuffer = Buffer.alloc(0);
let eventReconnectTimer = null;
let eventPingTimer = null;
let eventDebugCount = 0;

function sendWsFrame(text) {
  if (eventSocket === null || eventSocket.destroyed) return;
  const payload = Buffer.from(text, "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0xfe;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0xff;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  eventSocket.write(Buffer.concat([header, mask, masked]));
}

function sendWsPong() {
  if (eventSocket === null || eventSocket.destroyed) return;
  eventSocket.write(Buffer.from([0x8a, 0x80, 0, 0, 0, 0]));
}

function handleRemoteEventValue(value) {
  if (value === null || typeof value !== "object") return;
  if (value.type === "waterfall") {
    const eventId = typeof value.eventId === "string" ? value.eventId : "";
    const sessionId = typeof value.agentId === "string" ? value.agentId : "";
    if (eventId === "" || sessionId === "") return;
    const request = value.request ?? {};
    if (value.event === "approval/request") {
      pendingApprovals.set(eventId, {
        eventId,
        sessionId,
        toolName: typeof request.toolName === "string" ? request.toolName : "",
        callId: typeof request.callId === "string" ? request.callId : "",
        reason: typeof request.reason === "string" ? request.reason : "",
        at: Date.now(),
      });
      log(`审批请求 ${sessionId} ${request.toolName ?? ""} ${eventId}`);
    } else if (value.event === "user-questions/request") {
      pendingQuestions.set(eventId, {
        eventId,
        sessionId,
        questions: Array.isArray(request.questions) ? request.questions : [],
        at: Date.now(),
      });
      log(`选择题请求 ${sessionId} ${eventId}`);
    }
  } else if (value.type === "cancel") {
    const eventId = typeof value.eventId === "string" ? value.eventId : "";
    if (eventId !== "") {
      pendingApprovals.delete(eventId);
      pendingQuestions.delete(eventId);
    }
  }
}

function parseEventFrames() {
  for (;;) {
    const buffer = eventBuffer;
    if (buffer.length < 2) return;
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return;
      length = buffer.readUInt32BE(2) * 2 ** 32 + buffer.readUInt32BE(6);
      offset = 10;
    }
    let maskKey = null;
    if (masked) {
      if (buffer.length < offset + 4) return;
      maskKey = buffer.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buffer.length < offset + length) return;
    let payload = buffer.subarray(offset, offset + length);
    if (maskKey !== null) {
      const copy = Buffer.from(payload);
      for (let index = 0; index < copy.length; index += 1) copy[index] ^= maskKey[index % 4];
      payload = copy;
    }
    eventBuffer = buffer.subarray(offset + length);
    if (opcode === 0x9) {
      sendWsPong();
    } else if (opcode === 0x1) {
      let message;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch {
        continue;
      }
      if (eventDebugCount < 8) {
        eventDebugCount += 1;
        log(`evt rx ${payload.toString("utf8").slice(0, 180)}`);
      }
      if (message.type === "item") {
        const value = message.value;
        if (value?.type === "ready") {
          eventClientId = typeof value.clientId === "string" ? value.clientId : null;
          log(`审批事件通道就绪 clientId=${eventClientId}`);
        } else {
          handleRemoteEventValue(value);
        }
      } else if (message.type === "ready") {
        eventClientId = typeof message.clientId === "string" ? message.clientId : null;
        log(`审批事件通道就绪 clientId=${eventClientId}`);
      } else if (message.type === "error") {
        log(`审批事件通道错误 ${JSON.stringify(message).slice(0, 200)}`);
      }
    } else if (opcode === 0x8) {
      return;
    }
  }
}

function closeEventSocket() {
  if (eventPingTimer !== null) {
    clearInterval(eventPingTimer);
    eventPingTimer = null;
  }
  eventClientId = null;
  if (eventSocket !== null) {
    try {
      eventSocket.destroy();
    } catch {}
    eventSocket = null;
  }
  eventBuffer = Buffer.alloc(0);
}

function scheduleEventReconnect() {
  if (eventReconnectTimer !== null) return;
  eventReconnectTimer = setTimeout(() => {
    eventReconnectTimer = null;
    connectRemoteEvents();
  }, 4000);
}

function connectRemoteEvents() {
  if (eventSocket !== null) return;
  const port = upstream.port ?? HINT_PORT;
  const cookie = upstreamCookie() ?? "";
  const key = crypto.randomBytes(16).toString("base64");
  const request = http.request({
    host: UPSTREAM_HOST,
    port,
    path: "/api/remote.mux",
    method: "GET",
    headers: {
      host: `${UPSTREAM_HOST}:${port}`,
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-key": key,
      "sec-websocket-version": "13",
      origin: `http://${UPSTREAM_HOST}:${port}`,
      "user-agent": "dsh-mobile-gateway",
      cookie,
    },
  });
  request.on("upgrade", (response, socket, head) => {
    eventSocket = socket;
    eventBuffer = Buffer.alloc(0);
    socket.setNoDelay(true);
    log("审批事件通道已连接");
    if (head !== undefined && head.length > 0) {
      eventBuffer = Buffer.concat([eventBuffer, head]);
      parseEventFrames();
    }
    sendWsFrame(
      JSON.stringify({
        type: "open",
        streamId: "kpao-events",
        endpoint: "$events",
        payload: { args: {} },
      })
    );
    eventPingTimer = setInterval(() => {
      if (eventSocket === null || eventSocket.destroyed) return;
      try {
        eventSocket.write(Buffer.from([0x89, 0x00]));
      } catch {}
    }, 20000);
    socket.on("data", (chunk) => {
      eventBuffer = Buffer.concat([eventBuffer, chunk]);
      parseEventFrames();
    });
    socket.on("close", () => {
      log("审批事件通道断开");
      closeEventSocket();
      scheduleEventReconnect();
    });
    socket.on("error", () => {
      closeEventSocket();
      scheduleEventReconnect();
    });
  });
  request.on("error", () => scheduleEventReconnect());
  request.end();
}

async function answerRemoteEvent(eventId, outcome) {
  if (eventClientId === null) throw new Error("审批通道尚未就绪，请稍后重试");
  const body = {
    type: "client-request",
    rpcId: String(Date.now()),
    method: "$events/result",
    payload: { args: { clientId: eventClientId, eventId, outcome } },
  };
  const response = await dshRequest("/api/$events/result", "POST", body);
  let json;
  try {
    json = JSON.parse(response.text);
  } catch {
    throw new Error("DSH 返回异常");
  }
  if (json.result?.ok !== true) {
    throw new Error(json.result?.error?.message ?? "回答失败");
  }
  return json.result.value;
}

/* -------------------------------- 口令门 -------------------------------- */

const gateSecret = Buffer.from(config.gateSecret, "base64url");
const passSalt = Buffer.from(config.passSalt, "hex");
const passHash = Buffer.from(config.passHash, "hex");

function signGate(body) {
  return crypto.createHmac("sha256", gateSecret).update(body).digest("base64url");
}

function makeGateCookie() {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + 30 * 86400000 }), "utf8").toString("base64url");
  return `${body}.${signGate(body)}`;
}

function parseCookies(headerValue) {
  const out = {};
  if (typeof headerValue !== "string") return out;
  for (const segment of headerValue.split(";")) {
    const at = segment.indexOf("=");
    if (at === -1) continue;
    out[segment.slice(0, at).trim()] = segment.slice(at + 1).trim();
  }
  return out;
}

function gateOk(req) {
  const value = parseCookies(req.headers.cookie)[GATE_COOKIE];
  if (typeof value !== "string") return false;
  const at = value.lastIndexOf(".");
  if (at <= 0) return false;
  const body = value.slice(0, at);
  const sig = value.slice(at + 1);
  const expected = signGate(body);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function passcodeMatches(candidate) {
  if (typeof candidate !== "string" || candidate.length < 4 || candidate.length > 200) return false;
  const derived = crypto.scryptSync(candidate, passSalt, 64);
  return crypto.timingSafeEqual(derived, passHash);
}

const failures = new Map();

function rateLimited(ip) {
  const entry = failures.get(ip);
  if (entry === undefined) return false;
  if (entry.until <= Date.now()) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= 8;
}

function noteFailure(ip) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (entry === undefined || entry.until <= now) {
    failures.set(ip, { count: 1, until: now + 10 * 60_000 });
    return;
  }
  entry.count += 1;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function loginPage(nextPath, errorText = "") {
  const error = errorText === "" ? "" : `<p class="err">${escapeHtml(errorText)}</p>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#111114">
<title>Bot 手机入口</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         background: radial-gradient(1200px 600px at 20% -10%, #2b2b3a 0%, #141418 55%, #0c0c0f 100%); color: #f2f2f5; }
  .card { width: min(100%, 380px); background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.11);
          border-radius: 20px; padding: 28px 22px; }
  h1 { margin: 0 0 6px; font-size: 21px; letter-spacing: .5px; }
  p.sub { margin: 0 0 20px; font-size: 13px; color: #a7a7b4; line-height: 1.5; }
  input[type=password] { width: 100%; padding: 14px; font-size: 17px; letter-spacing: 2px;
          border-radius: 12px; border: 1px solid rgba(255,255,255,.16); background: rgba(0,0,0,.35); color: #fff; }
  input[type=password]:focus { outline: 2px solid #5b8cff; border-color: transparent; }
  button { margin-top: 14px; width: 100%; padding: 14px; font-size: 16px; font-weight: 600; border: 0;
           border-radius: 12px; color: #fff; background: linear-gradient(180deg, #4f7dff, #3d63e0); }
  .err { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; font-size: 13px; color: #ffb4b4;
         background: rgba(255,80,80,.13); border: 1px solid rgba(255,80,80,.25); }
  .tip { margin-top: 18px; font-size: 12px; color: #77778a; line-height: 1.6; }
</style>
</head>
<body>
  <div class="card">
    <h1>你的 Bot 手机入口</h1>
    <p class="sub">输入访问口令，即可在手机上继续用这台电脑上的 Bot。口令 30 天内有效。</p>
    ${error}
    <form method="post" action="/_gate/login">
      <input type="hidden" name="next" value="${escapeHtml(nextPath)}">
      <input type="password" name="passcode" placeholder="访问口令" autocomplete="current-password"
             autocapitalize="off" autocorrect="off" spellcheck="false" autofocus>
      <button type="submit">进入</button>
    </form>
    <p class="tip">这个页面转发到这台电脑上的 DeepSeek Harness。请勿把网址和口令分享给别人。</p>
  </div>
</body>
</html>`;
}

function sendLogin(req, res, nextPath) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(loginPage(nextPath));
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeNext(value) {
  if (typeof value !== "string" || value === "") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/_gate")) return "/";
  return value;
}

async function handleLogin(req, res) {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) {
    res.writeHead(429, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(loginPage("/", "尝试次数过多，请 10 分钟后再试。"));
    return;
  }
  let body = "";
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(413).end();
    return;
  }
  const params = new URLSearchParams(body);
  const next = safeNext(params.get("next"));
  if (!passcodeMatches(params.get("passcode") ?? "")) {
    noteFailure(ip);
    log("gate: 口令错误 ip=" + ip);
    res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(loginPage(next, "口令不正确。"));
    return;
  }
  failures.delete(ip);
  log("gate: 登录成功 ip=" + ip);
  res.writeHead(302, {
    location: next,
    "set-cookie": `${GATE_COOKIE}=${makeGateCookie()}; Max-Age=${GATE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    "cache-control": "no-store",
  });
  res.end();
}

/* ---------------------------- IM 适配层（手机端真实数据） ---------------------------- */

const BOT_STATE_PATH = path.join(DSH_HOME, "bot", "state.json");
const TASK_BOARD_PATH = path.join(DSH_HOME, "bot", "workspace", "org", "task-board.md");
const SESSION_ROOT = path.join(DSH_HOME, "sessions");
const roomSessionCache = new Map();

/** 任务板 Markdown 表格 → 任务数组。 */
function parseTaskBoard() {
  let text;
  try {
    text = fs.readFileSync(TASK_BOARD_PATH, "utf8");
  } catch {
    return [];
  }
  const tasks = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\|\s*(T-\d{8}-\d{2})\s*\|/u);
    if (!match) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    // | 编号 | 任务 | 提出 | 负责 | 状态 | 优先级 | 截止 | 交付物 | 验收标准 | 最后更新 |
    tasks.push({
      id: cells[1] ?? match[1],
      title: cells[2] ?? "",
      proposer: cells[3] ?? "",
      owner: cells[4] ?? "",
      status: cells[5] ?? "",
      priority: cells[6] ?? "",
      due: cells[7] ?? "",
      updated: cells[10] ?? cells[9] ?? "",
    });
  }
  return tasks;
}

/** 只给真实存在的上传图片渲染成图片，避免把引用的假路径显示成破图。 */
function existingImagePath(text) {
  const match = String(text ?? "").match(/【图片】\s*(uploads\/[^\s`]+)/u);
  if (!match) return null;
  const workspace = path.resolve(path.join(DSH_HOME, "bot", "workspace"));
  const uploads = path.resolve(path.join(workspace, "uploads"));
  const file = path.resolve(workspace, match[1]);
  if (!file.startsWith(uploads + path.sep)) return null;
  try {
    return fs.statSync(file).isFile() ? match[1] : null;
  } catch {
    return null;
  }
}

function annotateImages(items) {
  return items.map((item) => {
    const image = existingImagePath(item.text);
    return image === null ? item : { ...item, image };
  });
}

/** DSH `present` 工具产生的产物卡片：转成手机端可点击查看的文件消息。 */
function deliverableItems(event) {
  const files = Array.isArray(event.data?.files) ? event.data.files : [];
  const turn = Number(event.data?.turn) || null;
  return files
    .map((file, index) => ({
      id: "d" + event.seq + "-" + index,
      kind: "file",
      title: typeof file?.path === "string" ? path.basename(file.path) : "产物",
      path: typeof file?.path === "string" ? file.path : "",
      description: typeof file?.description === "string" ? file.description : "",
      time: event.time ?? null,
      seq: event.seq,
      turn,
    }))
    .filter((item) => item.path !== "" && DOCUMENT_FILE_RE.test(item.path));
}

function deliverablesFromSession(sessionId) {
  const data = readSessionData(sessionId);
  if (data === null) return [];
  const presented = new Map();
  const written = new Map();
  for (const event of data.events) {
    if (event.type === "deliverables/presented") {
      for (const item of deliverableItems(event)) presented.set(item.path, item);
      continue;
    }
    if (event.type !== "tool/call") continue;
    const file = productFromToolCall(event);
    if (file !== null && !written.has(file.path)) written.set(file.path, file);
  }
  // present 过的文件优先用它的标题/描述；其余按写文件工具补齐，按时间排序
  const merged = new Map(written);
  for (const [key, item] of presented) merged.set(key, item);
  return [...merged.values()]
    .sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0))
    .slice(-20);
}

const DOCUMENT_FILE_RE = /\.(md|markdown|txt|docx?|pdf|xlsx?|pptx?|csv|json|ya?ml|png|jpe?g|gif|webp|bmp|svg)$/i;

/** 从 `write` / `edit` 工具调用里提取工作区内的文档产物。 */
function productFromToolCall(event) {
  const data = event.data ?? {};
  const name = String(data.name ?? "");
  if (name !== "write" && name !== "edit") return null;
  let args = data.arguments ?? data.args;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (args === null || typeof args !== "object") return null;
  const raw = args.path ?? args.file_path ?? args.filePath ?? args.target ?? "";
  if (typeof raw !== "string" || raw === "") return null;
  const workspace = path.resolve(path.join(DSH_HOME, "bot", "workspace"));
  const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace, raw);
  if (!absolute.startsWith(workspace + path.sep)) return null;
  if (!DOCUMENT_FILE_RE.test(absolute)) return null;
  let description = "";
  const content = typeof args.content === "string" ? args.content : "";
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) description = heading[1].trim().slice(0, 100);
  return {
    id: "w" + event.seq,
    kind: "file",
    title: path.basename(absolute),
    path: raw,
    description,
    time: event.time ?? null,
    seq: event.seq,
    turn: Number(event.data?.turn) || null,
  };
}

/** 普通 DSH 会话当前是否在跑：看最后的 turn/start、turn/end 和 tool/call。 */
/** Bot 之间派活 / 群内发帖的工具调用，转成聊天里的系统提示。 */
function teamActionItems(sessionId) {
  const data = readSessionData(sessionId);
  if (data === null) return [];
  const out = [];
  for (const event of data.events) {
    if (event.type !== "tool/call") continue;
    const name = String(event.data?.name ?? "");
    if (name !== "message_bot" && name !== "post_to_group") continue;
    let args = event.data?.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        continue;
      }
    }
    if (args === null || typeof args !== "object") continue;
    const message = String(args.message ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90);
    if (message === "") continue;
    const target =
      name === "message_bot"
        ? String(args.bot ?? args.to ?? "Bot")
        : "群「" + String(args.group ?? "群") + "」";
    out.push({
      id: "a" + event.seq,
      kind: "event",
      text: "→ " + target + "：" + message,
      time: event.time ?? null,
      seq: event.seq,
      turn: Number(event.data?.turn) || null,
    });
  }
  return out.slice(-40);
}

function sessionLiveStatus(sessionId) {
  const data = readSessionData(sessionId);
  if (data === null) return null;
  let lastStart = null;
  let lastEnd = null;
  let lastTool = null;
  for (const event of data.events) {
    if (event.type === "turn/start") lastStart = event;
    else if (event.type === "turn/end") lastEnd = event;
    else if (event.type === "tool/call") lastTool = event;
  }
  if (lastStart === null) return null;
  const running = lastEnd === null || (lastStart.seq ?? 0) > (lastEnd.seq ?? 0);
  if (!running) return null;
  const status = { since: lastStart.time ?? null };
  if (lastTool !== null && (lastTool.seq ?? 0) > (lastStart.seq ?? 0)) {
    const data = lastTool.data ?? {};
    const name = data.name ?? data.tool ?? data.call?.name ?? "";
    if (name !== "") status.tool = String(name);
    let args = data.args ?? data.arguments ?? data.call?.args;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = undefined;
      }
    }
    const target = args?.file_path ?? args?.path ?? args?.command ?? args?.query ?? args?.url ?? "";
    if (target !== "") status.target = String(target).replace(/\s+/g, " ").slice(0, 80);
  }
  return status;
}

function dshSessionMessages(sessionId) {
  const data = readSessionData(sessionId);
  if (data === null) return [];
  const items = [];
  for (const event of data.events) {
    if (event.type === "user/message") {
      const data = event.data ?? {};
      const source = data.source ?? {};
      if (source.kind === "time-context") continue;
      const content = Array.isArray(data.content) ? data.content : [];
      const body = content
        .filter((block) => block && block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (body === "" || isSystemInjected(body)) continue;
      items.push({ id: "s" + event.seq, kind: "me", sender: "Owner", text: body.replace(/^(?:You|User):\s*/u, ""), time: event.time ?? null, seq: event.seq });
    } else if (event.type === "assistant/message") {
      const message = event.data?.message ?? {};
      const content = Array.isArray(message.content) ? message.content : [];
      const body = content
        .filter((block) => block && block.type === "text" && typeof block.text === "string" && block.text.trim() !== "")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (body === "") continue;
      items.push({ id: "s" + event.seq, kind: "bot", sender: "DSH Agent", text: body, time: event.time ?? null, seq: event.seq });
    } else if (event.type === "deliverables/presented") {
      items.push(...deliverableItems(event));
    }
  }
  return items;
}

/** 按 seq 分页：返回最后一页 + 是否还有更早的 + 下一页游标。 */
function pageBySeq(items, before, limit) {
  const sorted = items.slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const filtered = before === undefined ? sorted : sorted.filter((item) => (item.seq ?? 0) < before);
  const start = Math.max(0, filtered.length - limit);
  const page = filtered.slice(start);
  const hasMore = start > 0;
  return {
    items: page,
    hasMore,
    cursor: hasMore && page.length > 0 ? String(page[0].seq ?? "") : null,
  };
}

function jsonResponse(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/** 调本机 DSH 的上游接口，自动带浏览器会话 cookie。 */
function dshRequest(pathname, method, body) {
  return new Promise((resolve) => {
    void ensureUpstream().then(() => {
      const authority = `${UPSTREAM_HOST}:${upstream.port}`;
      const cookie = upstreamCookie();
      const payload = body === undefined ? null : JSON.stringify(body);
      const headers = {
        host: authority,
        "content-type": "application/json",
        "accept-encoding": "identity",
        "user-agent": "dsh-mobile-gateway",
      };
      if (cookie !== null) headers.cookie = cookie;
      if (payload !== null) headers["content-length"] = String(Buffer.byteLength(payload));
      const request = http.request(
        { host: UPSTREAM_HOST, port: upstream.port, path: pathname, method, headers },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode ?? 502, text: Buffer.concat(chunks).toString("utf8") })
          );
        }
      );
      request.on("error", () => resolve({ status: 502, text: "" }));
      request.setTimeout(15000, () => request.destroy());
      if (payload !== null) request.write(payload);
      request.end();
    });
  });
}

async function botApi(endpoint, payload) {
  const response = await dshRequest("/api/bot", "POST", { endpoint, payload });
  try {
    return JSON.parse(response.text);
  } catch {
    return { ok: false, error: { message: `DSH 返回异常（${response.status}）` } };
  }
}

const BOT_STATE_CACHE_FILE = path.join(DIR, "state-cache.json");
let cachedBotState = { at: 0, value: null, refreshing: null };

function loadBotStateCache() {
  try {
    const json = JSON.parse(fs.readFileSync(BOT_STATE_CACHE_FILE, "utf8"));
    if (json && json.value) cachedBotState.value = json;
  } catch {}
}
loadBotStateCache();

function saveBotStateCache(result) {
  try {
    const value = result.value ?? {};
    const light = {
      ok: result.ok,
      value: {
        revision: value.revision,
        bots: value.bots,
        rooms: value.rooms,
        agents: value.agents,
        work: value.work,
        activity: value.activity,
        questions: value.questions,
      },
    };
    fs.writeFileSync(BOT_STATE_CACHE_FILE, JSON.stringify(light));
  } catch {}
}

async function refreshBotStateNow() {
  try {
    await refreshBotState();
  } catch {}
}

function refreshBotState() {
  if (cachedBotState.refreshing !== null) return cachedBotState.refreshing;
  cachedBotState.refreshing = (async () => {
    try {
      const result = await botApi("state", { locale: "zh-CN" });
      if (result && result.ok) {
        cachedBotState = { at: Date.now(), value: result, refreshing: null };
        saveBotStateCache(result);
      } else {
        cachedBotState.refreshing = null;
      }
    } catch {
      cachedBotState.refreshing = null;
    }
  })();
  return cachedBotState.refreshing;
}

/** 短缓存 + 后台刷新：先返回缓存（重启后来自磁盘），慢的 DSH 扫描放到后台。 */
async function botStateCached(maxAgeMs = 2000) {
  if (cachedBotState.value !== null) {
    if (Date.now() - cachedBotState.at > maxAgeMs) void refreshBotState();
    return cachedBotState.value;
  }
  await refreshBotState();
  if (cachedBotState.value !== null) return cachedBotState.value;
  return await botApi("state", { locale: "zh-CN" });
}

/** DSH 原生 RPC：account/getBalance、session/cancel 这类。 */async function dshRpc(method, args) {
  const client = {
    version: "0.2.1-rc.5",
    locale: "zh-CN",
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
  const payloadArgs = method.startsWith("account/") ? { client, ...(args ?? {}) } : args ?? {};
  const body = {
    type: "client-request",
    rpcId: String(Date.now()),
    method,
    payload: { args: payloadArgs },
  };
  const response = await dshRequest("/api/" + method, "POST", body);
  try {
    return JSON.parse(response.text);
  } catch {
    return { result: { ok: false, error: { message: "DSH 返回异常" } } };
  }
}

function readBotState() {
  try {
    return JSON.parse(fs.readFileSync(BOT_STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

/** 多个 zstd 帧拼成的会话日志：解压一次并缓存解析后的事件，轮询时不再重复 split/JSON.parse。 */
const sessionDataCache = new Map();

function readSessionData(sessionId) {
  const dirs = fs.existsSync(SESSION_ROOT) ? fs.readdirSync(SESSION_ROOT) : [];
  for (const dir of dirs) {
    const file = path.join(SESSION_ROOT, dir, sessionId, "session.v4.jsonl.zstd");
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const cached = sessionDataCache.get(file);
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached;
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
    // 日志是追加写：文件变长时只解压新增帧、只解析新增行，避免每次轮询重解压全量
    if (cached && stat.size > cached.size && !cached.partial) {
      const rawTail = fs.readFileSync(file).subarray(cached.size);
      if (rawTail.length >= 4 && rawTail.subarray(0, 4).equals(magic)) {
        const tailPositions = [];
        let tailAt = 0;
        while ((tailAt = rawTail.indexOf(magic, tailAt)) !== -1) {
          tailPositions.push(tailAt);
          tailAt += 4;
        }
        let appended = "";
        for (let index = 0; index < tailPositions.length; index += 1) {
          const end = index + 1 < tailPositions.length ? tailPositions[index + 1] : rawTail.length;
          try {
            appended += zlib.zstdDecompressSync(rawTail.subarray(tailPositions[index], end)).toString("utf8");
          } catch {}
        }
        const appendedLines = appended.split("\n");
        const partial = appendedLines.pop() ?? "";
        const events = cached.events;
        for (const line of appendedLines) {
          if (line === "") continue;
          try {
            events.push(JSON.parse(line));
          } catch {}
        }
        const data = {
          mtime: stat.mtimeMs,
          size: stat.size,
          text: cached.text + appended,
          events,
          partial,
        };
        sessionDataCache.set(file, data);
        return data;
      }
    }
    const raw = fs.readFileSync(file);
    const positions = [];
    let at = 0;
    while ((at = raw.indexOf(magic, at)) !== -1) {
      positions.push(at);
      at += 4;
    }
    let text = "";
    for (let index = 0; index < positions.length; index += 1) {
      const end = index + 1 < positions.length ? positions[index + 1] : raw.length;
      try {
        text += zlib.zstdDecompressSync(raw.subarray(positions[index], end)).toString("utf8");
      } catch {}
    }
    const events = [];
    const lines = text.split("\n");
    const partial = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") continue;
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
    if (sessionDataCache.size > 12) sessionDataCache.clear();
    const data = { mtime: stat.mtimeMs, size: stat.size, text, events, partial };
    sessionDataCache.set(file, data);
    return data;
  }
  return null;
}

function readSessionText(sessionId) {
  const data = readSessionData(sessionId);
  return data === null ? null : data.text;
}

/** 会话日志里的“系统注入”文本，不进聊天记录。 */
function isSystemInjected(text) {
  return (
    text.startsWith("Current runtime context") ||
    text.startsWith("<system-reminder>") ||
    text.startsWith("Time sampled while preparing") ||
    text.startsWith("You are repeating the exact same tool call") ||
    text.startsWith("[Group chat created]")
  );
}

/** 读群聊：群自己的 Session 里，成员发言是 role=post 的消息，用户发言无 role。 */
function roomMessagesFromSession(sessionId) {
  const data = readSessionData(sessionId);
  if (data === null) return [];
  const items = [];
  for (const event of data.events) {
    if (event.type === "deliverables/presented") {
      items.push(...deliverableItems(event));
      continue;
    }
    if (event.type !== "user/message") continue;
    const data = event.data ?? {};
    const source = data.source ?? {};
    const content = Array.isArray(data.content) ? data.content : [];
    let text = content
      .filter((block) => block && block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text === "") continue;
    if (source.role === "kickoff") continue;
    if (source.role === "post") {
      const sender = source.senderName ?? "Bot";
      text = text.replace(/^\[Group post from [^\]]+\]\s*/u, "");
      if (text === "") continue;
      items.push({ id: "s" + event.seq, kind: "bot", sender, text, time: event.time ?? null, seq: event.seq });
    } else if (source.role === undefined) {
      if (isSystemInjected(text)) continue;
      items.push({ id: "s" + event.seq, kind: "me", sender: "Owner", text: text.replace(/^(?:You|User):\s*/u, ""), time: event.time ?? null, seq: event.seq });
    }
  }
  return items;
}

async function serveIm(req, res, url) {
  const pathname = url.pathname;
  log(`im ${req.method} ${pathname} ua=${String(req.headers["user-agent"] ?? "").slice(0, 70)}`);
  try {
    if (pathname === "/__im/state" && req.method === "GET") {
      const result = await botStateCached(800);
      if (!result.ok) {
        jsonResponse(res, 502, { ok: false, error: result.error ?? { message: "state failed" } });
        return;
      }
      const value = result.value ?? {};
      const sessionWork = {};
      jsonResponse(res, 200, {
        ok: true,
        revision: value.revision,
        bots: listOf(value.bots).map((bot) => ({
          id: bot.id,
          name: bot.name,
          role: bot.role ?? "",
          color: bot.color ?? "",
          sessionId: bot.sessionId ?? null,
          model: bot.appliedModel ?? bot.model ?? null,
        })),
        rooms: listOf(value.rooms).map((room) => ({
          id: room.id,
          name: room.name,
          members: Array.isArray(room.members) ? room.members : [],
          preview: typeof room.preview === "string" ? room.preview : "",
        })),
        agents: listOf(value.agents).map((agent) => ({
          id: agent.id,
          name: agent.name ?? "DSH Agent",
          sessions: Array.isArray(agent.sessions) ? agent.sessions : [],
        })),
        work: value.work ?? {},
        activity: value.activity ?? {},
        sessionWork,
        models: listOf(value.models),
        defaultModel: value.defaultModel ?? null,
      });
      return;
    }

    if (pathname === "/__im/pending" && req.method === "GET") {
      const id = String(url.searchParams.get("id") ?? "");
      const approvals = [...pendingApprovals.values()]
        .filter((item) => id === "" || item.sessionId === id)
        .map(({ eventId, sessionId, toolName, callId, reason, at }) => ({
          eventId,
          sessionId,
          toolName,
          callId,
          reason,
          at,
        }));
      const questions = [...pendingQuestions.values()]
        .filter((item) => id === "" || item.sessionId === id)
        .map(({ eventId, sessionId, questions: list, at }) => ({
          eventId,
          sessionId,
          questions: list,
          at,
        }));
      try {
        const stateResult = await botStateCached();
        for (const [sessionId, question] of Object.entries(stateResult.value?.questions ?? {})) {
          if (question === null || typeof question !== "object") continue;
          if (id !== "" && sessionId !== id) continue;
          questions.push({
            eventId: "dsbot:" + String(question.id ?? sessionId),
            sessionId,
            questions: [
              {
                id: question.id ?? sessionId,
                question: typeof question.question === "string" ? question.question : "",
                ...(question.detail ? { detail: question.detail } : {}),
                options: Array.isArray(question.options) ? question.options : [],
                multiSelect: question.multiSelect === true,
                allowCustom: question.allowCustom === true,
              },
            ],
            at: Number(question.askedAt) || 0,
            source: "dsbot",
          });
        }
      } catch {}
      jsonResponse(res, 200, { ok: true, approvals, questions });
      return;
    }

    if (pathname === "/__im/answer-approval" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const eventId = String(body.eventId ?? "");
      const outcome = String(body.outcome ?? "");
      if (eventId === "" || (outcome !== "allowed-once" && outcome !== "rejected")) {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少 eventId 或 outcome 非法" } });
        return;
      }
      try {
        const value = await answerRemoteEvent(eventId, { kind: "result", value: outcome });
        pendingApprovals.delete(eventId);
        jsonResponse(res, 200, { ok: true, value });
      } catch (error) {
        jsonResponse(res, 400, { ok: false, error: { message: error.message } });
      }
      return;
    }

    if (pathname === "/__im/answer-question" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const eventId = String(body.eventId ?? "");
      const answers = Array.isArray(body.answers) ? body.answers : [];
      if (eventId === "" || answers.length === 0) {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少 eventId 或 answers" } });
        return;
      }
      try {
        if (eventId.startsWith("dsbot:")) {
          const answer = answers[0] ?? {};
          const questionId = String(answer.id ?? eventId.slice(6));
          const answerPayload = {
            ...(Array.isArray(answer.selected) ? { selected: answer.selected } : {}),
            ...(typeof answer.custom === "string" && answer.custom !== ""
              ? { custom: answer.custom }
              : {}),
          };
          let sessionId = String(body.sessionId ?? "");
          // 前端带了 sessionId 就直接答，避免等 DSH 的 state 扫描
          if (sessionId !== "") {
            const direct = await botApi("answer-question", {
              sessionId,
              questionId,
              answer: answerPayload,
            });
            if (direct.ok) {
              jsonResponse(res, 200, direct);
              return;
            }
          }
          try {
            const stateResult = await botStateCached();
            const pendingMap = stateResult.value?.questions ?? {};
            if (pendingMap[sessionId] === undefined) {
              for (const [sid, question] of Object.entries(pendingMap)) {
                if (question?.id === questionId) {
                  sessionId = sid;
                  break;
                }
              }
            }
            if (pendingMap[sessionId] === undefined) {
              const owner = listOf(stateResult.value?.bots).find(
                (bot) => bot.id === String(body.sessionId ?? "") || bot.id === questionId
              );
              if (owner?.sessionId) sessionId = owner.sessionId;
            }
          } catch {}
          if (sessionId === "") {
            jsonResponse(res, 400, { ok: false, error: { message: "找不到这个问题的会话" } });
            return;
          }
          const result = await botApi("answer-question", {
            sessionId,
            questionId,
            answer: answerPayload,
          });
          jsonResponse(res, result.ok ? 200 : 400, result);
          return;
        }
        const value = await answerRemoteEvent(eventId, { kind: "result", value: { answers } });
        pendingQuestions.delete(eventId);
        jsonResponse(res, 200, { ok: true, value });
      } catch (error) {
        jsonResponse(res, 400, { ok: false, error: { message: error.message } });
      }
      return;
    }

    if (pathname === "/__im/approvals" && req.method === "GET") {
      const result = await botApi("state", { locale: "zh-CN" });
      jsonResponse(res, 200, {
        ok: true,
        approvals: listOf(result.value?.work?.approvals).filter((entry) => entry.answerable !== false),
      });
      return;
    }

    if (pathname === "/__im/approve" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await botApi("approval-answer", {
        id: String(body.id ?? ""),
        choice: String(body.choice ?? "allow"),
      });
      jsonResponse(res, result.ok ? 200 : 400, result);
      return;
    }

    if (pathname === "/__im/sessions" && req.method === "GET") {
      const result = await dshRpc("session/list", { _request: {} });
      const items = listOf(result.result?.value?.items).map((session) => ({
        id: session.sessionId,
        title: session.projections?.values?.title ?? "",
        updatedAt: session.updatedAt ?? 0,
        running: session.running === true,
        blank: session.blank === true,
        cwd: session.cwd ?? "",
      }));
      jsonResponse(res, 200, { ok: true, items });
      return;
    }

    if (pathname === "/__im/sessions/new" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const workspace = path.resolve(path.join(DSH_HOME, "bot", "workspace"));
      const created = await dshRpc("session/create", { request: { cwd: body.cwd ?? workspace } });
      const sessionId = created.result?.value?.sessionId;
      if (sessionId === undefined) {
        jsonResponse(res, 400, { ok: false, error: created.result?.error ?? { message: "创建会话失败" } });
        return;
      }
      const now = new Date();
      const fallback = `新会话 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const title = String(body.title ?? "").trim() || fallback;
      await dshRpc("session/rename", { request: { sessionId, title } });
      jsonResponse(res, 200, { ok: true, id: sessionId, title });
      return;
    }

    if (pathname === "/__im/sessions/rename" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const sessionId = String(body.id ?? "");
      const title = String(body.title ?? "").trim();
      if (sessionId === "" || title === "") {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少 id 或标题" } });
        return;
      }
      const result = await dshRpc("session/rename", { request: { sessionId, title } });
      jsonResponse(res, result.result?.ok ? 200 : 400, {
        ok: !!result.result?.ok,
        title,
        error: result.result?.error ?? null,
      });
      return;
    }

    if (pathname === "/__im/account" && req.method === "GET") {
      const balance = await dshRpc("account/getBalance");
      const profile = await dshRpc("account/getProfile");
      const balanceValue = balance.result?.ok ? balance.result.value : null;
      const profileValue = profile.result?.ok ? profile.result.value : null;
      jsonResponse(res, 200, {
        ok: true,
        status: balanceValue?.status ?? "unknown",
        balance: Array.isArray(balanceValue?.value) ? balanceValue.value : [],
        bonusWallets: Array.isArray(balanceValue?.bonusWallets) ? balanceValue.bonusWallets : [],
        profile: profileValue?.value ?? null,
      });
      return;
    }

    if (pathname === "/__im/usage" && req.method === "GET") {
      const result = await botApi("usage", { timeZone: "Asia/Shanghai" });
      jsonResponse(res, result.ok ? 200 : 400, { ok: result.ok, usage: result.value ?? null, error: result.error });
      return;
    }

    if (pathname === "/__im/stop" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = String(body.id ?? "");
      if (id === "") {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少 id" } });
        return;
      }
      const stateResult = await botApi("state", { locale: "zh-CN" });
      let sessionId = id;
      const bot = listOf(stateResult.value?.bots).find((item) => item.id === id);
      if (bot?.sessionId) sessionId = bot.sessionId;
      const room = listOf(stateResult.value?.rooms).find((item) => item.id === id);
      if (room?.sessionId) sessionId = room.sessionId;
      const result = await dshRpc("session/cancel", { request: { sessionId } });
      jsonResponse(res, 200, {
        ok: !!result.result?.ok,
        value: result.result?.value ?? null,
        error: result.result?.error ?? null,
      });
      return;
    }

    if (pathname === "/__im/tasks" && req.method === "GET") {
      jsonResponse(res, 200, { ok: true, tasks: parseTaskBoard() });
      return;
    }

    if (pathname === "/__im/chat" && req.method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      const rawCursor = url.searchParams.get("cursor") ?? "";
      if (id === "") {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少 id" } });
        return;
      }
      const before = Number.isFinite(Number(rawCursor)) && rawCursor !== "" ? Number(rawCursor) : undefined;
      const limitParam = Number(url.searchParams.get("limit") ?? "");
      const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(10, limitParam)) : 40;
      const fileState = readBotState();
      const rooms = listOf(fileState?.rooms);
      const room = rooms.find((entry) => entry.id === id);
      if (room) {
        const paged = pageBySeq(annotateImages(roomMessagesFromSession(room.sessionId ?? room.id)), before, limit);
        jsonResponse(res, 200, { ok: true, id, kind: "room", ...paged });
        return;
      }
      let cursorObject;
      if (rawCursor !== "") {
        try {
          cursorObject = JSON.parse(rawCursor);
        } catch {
          cursorObject = undefined;
        }
      }
      const result = await botApi("chat", cursorObject === undefined ? { botId: id } : { botId: id, cursor: cursorObject });
      if (result.ok) {
        const items = annotateImages(listOf(result.value?.items).map((item) => ({
          id: "c" + (item.seq ?? Math.random()),
          kind: item.kind === "user" ? "me" : item.kind === "bot" ? "bot" : "event",
          sender: item.sender ?? null,
          text: typeof item.text === "string" ? item.text : typeof item.title === "string" ? item.title : "",
          time: item.time ?? null,
          seq: item.seq ?? 0,
        })).filter((item) => item.text !== ""));
        const nextCursor = result.value?.cursor ?? null;
        const workState = await botStateCached(3000);
        const botWork = workState.value?.work?.bots?.[id] ?? null;
        // 让 Bot 之间的派活 / 群内发帖在聊天里以系统提示显示
        let actionMsgs = [];
        if (cursorObject === undefined) {
          const owner = listOf(workState.value?.bots).find((bot) => bot.id === id);
          if (owner?.sessionId) {
            const minTime = items.length
              ? Math.min(...items.map((item) => Number(item.time) || 0))
              : 0;
            actionMsgs = teamActionItems(owner.sessionId).filter(
              (item) => (Number(item.time) || 0) >= minTime
            );
          }
        }
        const mergedItems = [...items, ...actionMsgs].sort(
          (a, b) => (Number(a.time) || 0) - (Number(b.time) || 0)
        );
        jsonResponse(res, 200, {
          ok: true,
          id,
          kind: "bot",
          sessionStatus: botWork,
          items: mergedItems,
          hasMore: nextCursor !== null,
          cursor: nextCursor === null ? null : JSON.stringify(nextCursor),
        });
        return;
      }
      // 不是 ds-bot 的 Bot：按普通 DSH 会话（DSH Agent）读
      const agentItems = dshSessionMessages(id);
      if (agentItems.length > 0 || result.error?.code === "bot/not-found") {
        const paged = pageBySeq(annotateImages(agentItems), before, limit);
        jsonResponse(res, 200, {
          ok: true,
          id,
          kind: "agent",
          sessionStatus: sessionLiveStatus(id),
          ...paged,
        });
        return;
      }
      jsonResponse(res, 200, { ok: true, id, kind: "bot", items: [], hasMore: false, cursor: null });
      return;
    }

    if (pathname === "/__im/send" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)) || "{}");
      const id = String(body.id ?? "");
      const text = String(body.text ?? "").trim();
      if (id === "" || text === "") {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少 id 或 text" } });
        return;
      }
      const result = await botApi("send", { sessionId: id, text });
      jsonResponse(res, result.ok ? 200 : 400, result);
      return;
    }

    if (pathname === "/__im/delete-bot" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const botId = String(body.id ?? "");
      if (botId === "") {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少 id" } });
        return;
      }
      const result = await botApi("delete-bot", { id: botId });
      if (result.ok) await refreshBotStateNow();
      jsonResponse(res, result.ok ? 200 : 400, result);
      return;
    }

    if (pathname === "/__im/create-bot" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 1024 * 1024)) || "{}");
      const name = String(body.name ?? "").trim();
      if (name === "") {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少名称" } });
        return;
      }
      const result = await botApi("create-bot", {
        name,
        role: String(body.role ?? "").trim(),
        color: String(body.color ?? "deepseek"),
        instructions: String(body.instructions ?? "").trim(),
      });
      if (result.ok) await refreshBotStateNow();
      jsonResponse(res, result.ok ? 200 : 400, result);
      return;
    }

    if (pathname === "/__im/create-room" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const name = String(body.name ?? "").trim();
      const members = Array.isArray(body.members) ? body.members : [];
      if (name === "" || members.length === 0) {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少群名或成员" } });
        return;
      }
      const result = await botApi("create-room", { name, members, greet: false });
      if (result.ok) await refreshBotStateNow();
      jsonResponse(res, result.ok ? 200 : 400, result);
      return;
    }

    if (pathname === "/__im/add-members" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await botApi("update-room", {
        id: String(body.id ?? ""),
        add: Array.isArray(body.add) ? body.add : [],
      });
      if (result.ok) await refreshBotStateNow();
      jsonResponse(res, result.ok ? 200 : 400, result);
      return;
    }

    if (pathname === "/__im/upload" && req.method === "POST") {
      const raw = await readBody(req, 16 * 1024 * 1024);
      const body = JSON.parse(raw || "{}");
      const mime = String(body.mime ?? "");
      if (!mime.startsWith("image/")) {
        jsonResponse(res, 400, { ok: false, error: { message: "只支持图片" } });
        return;
      }
      const buffer = Buffer.from(String(body.data ?? ""), "base64");
      if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
        jsonResponse(res, 400, { ok: false, error: { message: "图片为空或超过 10MB" } });
        return;
      }
      const dir = path.join(DSH_HOME, "bot", "workspace", "uploads");
      fs.mkdirSync(dir, { recursive: true });
      const ext = (mime.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "") || "png";
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buffer);
      jsonResponse(res, 200, { ok: true, path: `uploads/${name}`, name });
      return;
    }

    if (pathname === "/__im/deliverables" && req.method === "GET") {
      const id = String(url.searchParams.get("id") ?? "");
      if (id === "") {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少 id" } });
        return;
      }
      const stateResult = await botStateCached(3000);
      const bot = listOf(stateResult.value?.bots).find((item) => item.id === id);
      const room = listOf(stateResult.value?.rooms).find((item) => item.id === id);
      const sessionId = bot?.sessionId ?? room?.sessionId ?? id;
      jsonResponse(res, 200, { ok: true, items: deliverablesFromSession(sessionId) });
      return;
    }

    if (pathname === "/__im/file" && req.method === "GET") {
      const rel = String(url.searchParams.get("path") ?? "");
      if (rel === "") {
        jsonResponse(res, 400, { ok: false, error: { message: "缺少 path" } });
        return;
      }
      const workspace = path.resolve(path.join(DSH_HOME, "bot", "workspace"));
      const file = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(workspace, rel);
      if (!file.startsWith(workspace + path.sep)) {
        jsonResponse(res, 403, { ok: false, error: { message: "forbidden" } });
        return;
      }
      fs.stat(file, (error, stat) => {
        if (error || !stat.isFile()) {
          res.writeHead(404).end("not found");
          return;
        }
        const ext = path.extname(file).toLowerCase();
        const mime =
          {
            ".md": "text/markdown; charset=utf-8",
            ".markdown": "text/markdown; charset=utf-8",
            ".txt": "text/plain; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".csv": "text/csv; charset=utf-8",
            ".log": "text/plain; charset=utf-8",
            ".html": "text/html; charset=utf-8",
            ".xml": "application/xml; charset=utf-8",
            ".svg": "image/svg+xml",
          }[ext] ?? "application/octet-stream";
        if (url.searchParams.get("raw") === "1") {
          res.writeHead(200, {
            "content-type": mime,
            "content-length": String(stat.size),
            "cache-control": "no-store",
            "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
          });
          fs.createReadStream(file).pipe(res);
          return;
        }
        if (stat.size > 3 * 1024 * 1024) {
          jsonResponse(res, 400, { ok: false, error: { message: "文件较大，请下载查看" } });
          return;
        }
        if (!/\.(md|markdown|txt|json|ya?ml|csv|tsv|log|js|mjs|cjs|ts|tsx|jsx|py|ps1|sh|html|css|xml|toml|ini)$/i.test(ext)) {
          jsonResponse(res, 400, { ok: false, error: { message: "这个文件类型暂不支持预览，请下载" } });
          return;
        }
        let text = "";
        try {
          text = fs.readFileSync(file, "utf8");
        } catch (readError) {
          jsonResponse(res, 500, { ok: false, error: { message: readError.message } });
          return;
        }
        jsonResponse(res, 200, {
          ok: true,
          path: rel,
          title: path.basename(file),
          ext,
          size: stat.size,
          text,
        });
      });
      return;
    }

    if (pathname === "/__im/files" && req.method === "GET") {
      const rel = String(url.searchParams.get("path") ?? "");
      const workspace = path.resolve(path.join(DSH_HOME, "bot", "workspace"));
      const uploads = path.resolve(path.join(workspace, "uploads"));
      const file = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(workspace, rel);
      const inUploads = file.startsWith(uploads + path.sep);
      const inWorkspace = file.startsWith(workspace + path.sep);
      const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/i.test(file);
      if (!isImage || (!inUploads && !inWorkspace)) {
        jsonResponse(res, 403, { ok: false, error: { message: "forbidden" } });
        return;
      }
      fs.stat(file, (error, stat) => {
        if (error || !stat.isFile()) {
          res.writeHead(404).end("not found");
          return;
        }
        const type =
          {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
            ".heic": "image/heic"
          }[path.extname(file).toLowerCase()] ?? "application/octet-stream";
        res.writeHead(200, {
          "content-type": type,
          "content-length": String(stat.size),
          "cache-control": "no-store"
        });
        fs.createReadStream(file).pipe(res);
      });
      return;
    }

    jsonResponse(res, 404, { ok: false, error: { message: "not found" } });
  } catch (error) {
    log("im 错误 " + error.message);
    jsonResponse(res, 500, { ok: false, error: { message: error.message } });
  }
}

/* ---------------------------- 原型静态页 ---------------------------- */

/** 把 /__proto/xxx 映射到 prototype/xxx；拒绝越出目录的路径。 */
function servePrototype(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice(PROTO_PREFIX.length));
  } catch {
    res.writeHead(400).end("bad path");
    return;
  }
  if (rel === "") rel = "index.html";
  const root = path.resolve(PROTO_DIR);
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    const headers = {
      "content-type": PROTO_MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(stat.size),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
    log(`proto ${req.method} ${pathname} (${stat.size}B)`);
  });
}

/* --------------------------- 响应改写：注入连接守护 --------------------------- */

/** 解出上游响应的明文（上游只给 gzip / br / deflate 或明文）。 */
function plainBody(headers, chunks) {
  const raw = Buffer.concat(chunks);
  const encoding = String(headers["content-encoding"] ?? "");
  try {
    if (encoding === "br") return zlib.brotliDecompressSync(raw);
    if (encoding === "gzip") return zlib.gunzipSync(raw);
    if (encoding === "deflate") return zlib.inflateSync(raw);
    if (encoding === "") return raw;
  } catch {
    return null;
  }
  return null;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|OhOS|Windows Phone/i;

/**
 * 手机浏览器访问网关根路径时切到 IM 界面；桌面浏览器（或 ?desktop=1）仍看原来的 DSH GUI。
 */
function shouldServeMobileUi(req, url) {
  if (url.searchParams.get("desktop") === "1") return false;
  if (!MOBILE_UA.test(String(req.headers["user-agent"] ?? ""))) return false;
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  return url.pathname === "/" || url.pathname === "/index.html";
}
function injectGuard(req, headers, status, chunks) {
  if (status !== 200) return chunks;
  const contentType = String(headers["content-type"] ?? "");
  if (!contentType.startsWith("text/html")) return chunks;
  const plain = plainBody(headers, chunks);
  if (plain === null) return chunks;
  let html = plain.toString("utf8");
  if (html.includes("__dshMobileGuard")) return chunks;
  if (!html.includes("</head>")) return chunks;
  html = html.replace("</head>", `<script src="/__guard.js"></script></head>`);
  delete headers["content-encoding"];
  delete headers["content-length"];
  delete headers["etag"];
  return [Buffer.from(html, "utf8")];
}

/* ------------------------------- 反向代理 ------------------------------- */

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function upstreamHeaders(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key)) continue;
    headers[key] = value;
  }
  const authority = `${UPSTREAM_HOST}:${upstream.port}`;
  const origin = `http://${authority}`;
  headers.host = authority;
  const cookie = upstreamCookie();
  if (cookie !== null) headers.cookie = cookie;
  else delete headers.cookie;
  if (headers.origin !== undefined) headers.origin = origin;
  if (typeof headers.referer === "string") {
    try {
      const parsed = new URL(headers.referer);
      headers.referer = origin + parsed.pathname + parsed.search;
    } catch {
      delete headers.referer;
    }
  }
  return headers;
}

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** 静态资源交给 Cloudflare 边缘缓存，回访时不必再走隧道。 */
function paintResponse(req, headers, status, chunks) {
  const pathname = (req.url ?? "/").split("?")[0];
  const contentType = String(headers["content-type"] ?? "");
  const isAsset = (pathname.startsWith("/assets/") || pathname.startsWith("/plugins/")) && status === 200;
  if (isAsset) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
    return;
  }
  if (contentType.startsWith("text/html")) headers["cache-control"] = "no-store";
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/u;

/** 用 brotli 重新压缩文本响应，减小隧道上的字节数（DSH 只给 gzip level 1）。 */
function encodeBody(req, headers, chunks) {
  const raw = Buffer.concat(chunks);
  const contentType = String(headers["content-type"] ?? "");
  const acceptEncoding = String(req.headers["accept-encoding"] ?? "");
  if (raw.length <= 1024) return raw;
  if (!acceptEncoding.includes("br")) return raw;
  if (!COMPRESSIBLE.test(contentType)) return raw;
  const encoding = String(headers["content-encoding"] ?? "");
  let plain;
  try {
    if (encoding === "br") return raw;
    if (encoding === "gzip") plain = zlib.gunzipSync(raw);
    else if (encoding === "deflate") plain = zlib.inflateSync(raw);
    else if (encoding === "") plain = raw;
    else return raw;
  } catch {
    return raw;
  }
  try {
    const compressed = zlib.brotliCompressSync(plain, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: plain.length,
      },
    });
    if (compressed.length >= raw.length) return raw;
    headers["content-encoding"] = "br";
    delete headers["etag"];
    return compressed;
  } catch {
    return raw;
  }
}

async function proxyHttp(req, res, attempt = 1) {
  await ensureUpstream();
  const headers = upstreamHeaders(req);
  const startedAt = Date.now();
  const upstreamReq = http.request(
    { host: UPSTREAM_HOST, port: upstream.port, method: req.method, path: req.url, headers },
    (upRes) => {
      const responseHeaders = {};
      for (const [key, value] of Object.entries(upRes.headers)) {
        if (value === undefined) continue;
        if (HOP_BY_HOP.has(key)) continue;
        responseHeaders[key] = value;
      }
      if (upRes.statusCode === 401) {
        log("上游 401，重新发现 DSH 上游");
        upstream = { port: upstream.port, cookie: null, at: 0 };
      }
      const isEventStream = typeof upRes.headers["content-type"] === "string" && upRes.headers["content-type"].includes("text/event-stream");
      if (isEventStream) {
        res.writeHead(upRes.statusCode ?? 502, responseHeaders);
        // 定期写 SSE 注释行，避免手机网络 / Cloudflare 把空闲连接掐掉。
        const keepAlive = setInterval(() => {
          try {
            res.write(": keepalive\n\n");
          } catch {}
        }, 20000);
        const stopKeepAlive = () => clearInterval(keepAlive);
        upRes.on("end", stopKeepAlive);
        upRes.on("error", stopKeepAlive);
        res.on("close", stopKeepAlive);
        upRes.pipe(res);
        upRes.on("error", () => res.destroy());
        return;
      }
      // 缓冲后带 content-length 发出：Cloudflare 对 chunked 响应会缓冲/压缩，直接流式会卡住。
      const chunks = [];
      let size = 0;
      let overflow = false;
      upRes.on("data", (chunk) => {
        if (overflow) return;
        size += chunk.length;
        if (size > MAX_BUFFER_BYTES) {
          overflow = true;
          res.writeHead(upRes.statusCode ?? 502, responseHeaders);
          for (const item of chunks) res.write(item);
          chunks.length = 0;
          upRes.pipe(res);
          return;
        }
        chunks.push(chunk);
      });
      upRes.on("end", () => {
        if (overflow) return;
        const finalChunks = injectGuard(req, responseHeaders, upRes.statusCode ?? 502, chunks);
        paintResponse(req, responseHeaders, upRes.statusCode ?? 502, finalChunks);
        const body = encodeBody(req, responseHeaders, finalChunks);
        responseHeaders["content-length"] = String(body.length);
        res.writeHead(upRes.statusCode ?? 502, responseHeaders);
        res.end(body);
        log(`proxy ${req.method} ${req.url} -> ${upRes.statusCode} ${body.length}B ${Date.now() - startedAt}ms`);
      });
      upRes.on("error", () => res.destroy());
    },
  );
  upstreamReq.on("error", (error) => {
    log("上游错误 " + error.message + " (port " + upstream.port + ")");
    if (!res.headersSent && attempt < 2) {
      upstream = { port: upstream.port, cookie: null, at: 0 };
      void proxyHttp(req, res, attempt + 1);
      return;
    }
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("网关连不上本机 DSH：" + error.message);
    } else {
      res.destroy();
    }
  });
  req.pipe(upstreamReq);
  req.on("aborted", () => upstreamReq.destroy());
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/_gate/logout") {
    res.writeHead(302, {
      location: "/",
      "set-cookie": `${GATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
      "cache-control": "no-store",
    });
    res.end();
    return;
  }
  if (!gateOk(req)) {
    if (url.pathname === "/_gate/login" && req.method === "POST") {
      void handleLogin(req, res);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const next = url.pathname + url.search;
      sendLogin(req, res, next.startsWith("/_gate") ? "/" : next);
      return;
    }
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("unauthorized");
    return;
  }
  if (url.pathname === "/__guard.js") {
    fs.readFile(GUARD_PATH, (error, buffer) => {
      if (error) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": String(buffer.length),
        "cache-control": "no-store",
      });
      res.end(buffer);
    });
    return;
  }
  if (shouldServeMobileUi(req, url)) {
    res.writeHead(302, {
      location: `${PROTO_PREFIX}?v=${PROTO_VERSION}`,
      "cache-control": "no-store",
    });
    res.end();
    return;
  }
  if (url.pathname.startsWith("/__im/")) {
    void serveIm(req, res, url);
    return;
  }
  if (url.pathname === "/__proto") {
    res.writeHead(302, { location: `${PROTO_PREFIX}?v=${PROTO_VERSION}`, "cache-control": "no-store" });
    res.end();
    return;
  }
  if (url.pathname === PROTO_PREFIX && url.searchParams.get("v") !== PROTO_VERSION) {
    // 手机浏览器可能缓存旧 HTML/JS：强制换一个带版本号的地址，保证拿到新前端。
    res.writeHead(302, { location: `${PROTO_PREFIX}?v=${PROTO_VERSION}`, "cache-control": "no-store" });
    res.end();
    return;
  }
  if (url.pathname === PROTO_PREFIX.slice(0, -1) || url.pathname.startsWith(PROTO_PREFIX)) {
    servePrototype(req, res, url.pathname === "/__proto" ? PROTO_PREFIX : url.pathname);
    return;
  }
  void proxyHttp(req, res);
});

server.requestTimeout = 0;
server.headersTimeout = 60000;
server.keepAliveTimeout = 65000;

server.on("connection", (socket) => {
  const address = socket.remoteAddress ?? "";
  const loopback = address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
  if (!loopback) socket.destroy();
});

server.on("upgrade", (req, socket, head) => {
  if (!gateOk(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }
  void (async () => {
    await ensureUpstream();
    const headers = upstreamHeaders(req);
    // upstreamHeaders 会去掉逐跳头；但 WebSocket 升级必须带上这两个，
    // 否则上游把请求当普通 HTTP 处理，事件流就永远连不上（表现为「一直显示运行中」）。
    headers.connection = "Upgrade";
    headers.upgrade = req.headers.upgrade ?? "websocket";
    let raw = `GET ${req.url} HTTP/1.1\r\n`;
    for (const [key, value] of Object.entries(headers)) {
      for (const item of Array.isArray(value) ? value : [value]) raw += `${key}: ${item}\r\n`;
    }
    raw += "\r\n";
    const upstreamSocket = net.connect({ host: UPSTREAM_HOST, port: upstream.port }, () => {
      upstreamSocket.write(raw);
      if (head !== undefined && head.length > 0) upstreamSocket.write(head);
      socket.pipe(upstreamSocket);
      upstreamSocket.pipe(socket);
      // 每 20 秒给浏览器发一个 WebSocket ping 帧，避免 Cloudflare / 手机网络把空闲连接掐掉。
      const pingTimer = setInterval(() => {
        if (socket.destroyed) return;
        try {
          socket.write(Buffer.from([0x89, 0x00]));
        } catch {}
      }, 20000);
      const stopPing = () => clearInterval(pingTimer);
      socket.on("close", stopPing);
      socket.on("error", stopPing);
      upstreamSocket.on("close", stopPing);
      log(`ws-open ${req.url}`);
    });
    upstreamSocket.on("error", (error) => {
      log(`ws-error ${req.url} ${error.message}`);
      socket.destroy();
    });
    socket.on("error", () => upstreamSocket.destroy());
    socket.on("close", () => {
      log(`ws-close ${req.url}`);
      upstreamSocket.destroy();
    });
  })();
});

server.on("clientError", (error, socket) => {
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch {}
});

server.listen(LISTEN_PORT, "::", () => {
  log(`网关已启动 http://127.0.0.1:${LISTEN_PORT}，上游自动发现（提示端口 ${HINT_PORT}）`);
  connectRemoteEvents();
});
