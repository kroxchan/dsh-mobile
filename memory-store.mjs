/**
 * 共享长期记忆 / 知识库。
 *
 * 设计目标：
 * - DSH Agent、QQ Bot、手机端共用同一份 JSON 记忆；
 * - 不依赖向量库，先做可靠的关键词检索和人工可读条目；
 * - 条目有来源、标签、作用域，回答时可以引用。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const WORKSPACE =
  process.env.DSH_WORKSPACE ||
  path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "bot", "workspace");

export const MEMORY_FILE =
  process.env.DSH_MEMORY_FILE || path.join(WORKSPACE, "knowledge", "memory.json");

const DEFAULT_ENTRIES = [
  {
    title: "Krox 的基本偏好",
    text: "Krox 使用简体中文；要求直接执行、少解释；文档交付同时给 .md 文件和飞书在线文档链接；重要项目改动后要沉淀长期记忆。",
    tags: ["krox", "preference", "language", "feishu"],
    source: "AGENTS.md",
    scope: "shared",
  },
  {
    title: "手机端 DSH Mobile 的定位",
    text: "DSH Mobile 是把本机 DeepSeek Harness 接到手机使用的 IM 风格 Web 前端与本机网关，不是 DeepSeek 官方插件；安装需要 Node 22、DSH Desktop 和 HTTPS（公网/PWA）。",
    tags: ["dsh-mobile", "gateway", "architecture"],
    source: "README.md",
    scope: "shared",
  },
  {
    title: "手机端过程与思考展示规则",
    text: "底部只保留一个处理过程入口；只显示一行最新思考/工具调用；不要“思/工具”前缀；详情里的实时思考作为思考卡原地更新；只显示本轮，不叠历史。",
    tags: ["dsh-mobile", "ui", "trace", "thinking"],
    source: "AGENTS.md",
    scope: "shared",
  },
  {
    title: "系统通知与 Web Push",
    text: "DSH Mobile 前台用轮询检测任务完成，后台用 Web Push（VAPID + service worker + 服务端 watcher）。iOS 必须添加到主屏幕；网关/DSH 关闭时无法推送。",
    tags: ["dsh-mobile", "notification", "web-push", "ios"],
    source: "docs/DEVELOPMENT-MEMORY.md",
    scope: "shared",
  },
  {
    title: "QQ Bot 的内容与政治规则",
    text: "QQ Bot 不经过 DSH purge；政治、历史、公共议题直接回答，不回避、不说教，区分事实与观点；成人向虚构限定成年人、自愿。",
    tags: ["qq-bot", "politics", "adult", "rules"],
    source: "qq-bot/persona/rules.md",
    scope: "shared",
  },
  {
    title: "共享知识库的存在方式",
    text: "工作区 knowledge/index.md 是人工知识索引；本文件 knowledge/memory.json 是跨 Agent 的长期记忆。Bot 的 MEMORY.md 是个人记忆，QQ Bot 的 data/learn/curated.md 是 QQ 侧经验。",
    tags: ["knowledge", "memory", "agents", "qq-bot"],
    source: "knowledge/index.md",
    scope: "shared",
  },
  {
    title: "社区发布定位",
    text: "dsh-mobile 对外按 DSH 配套生态应用发布，不冒充官方或 dsh plugin add 插件；dsh.so 是独立社区，收录不等于官方安全认证。",
    tags: ["community", "dsh.so", "release"],
    source: "COMMUNITY.md",
    scope: "shared",
  },
];

function ensureDir() {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
}

function readRaw() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {}
  return null;
}

function seed() {
  const now = Date.now();
  return DEFAULT_ENTRIES.map((entry, index) => ({
    id: "m-seed-" + String(index + 1).padStart(2, "0"),
    ...entry,
    createdAt: now,
    updatedAt: now,
  }));
}

let cache = null;
let cacheMtime = 0;
let cacheSize = -1;

export function loadMemory({ seedIfMissing = true } = {}) {
  ensureDir();
  try {
    const stat = fs.statSync(MEMORY_FILE);
    if (cache !== null && cacheMtime === stat.mtimeMs && cacheSize === stat.size) return cache;
    cacheMtime = stat.mtimeMs;
    cacheSize = stat.size;
  } catch {
    // 文件还没生成，走下面的 seed 分支
  }
  let entries = readRaw();
  if (entries === null) {
    entries = seedIfMissing ? seed() : [];
    writeMemory(entries);
  }
  cache = entries;
  try {
    const stat = fs.statSync(MEMORY_FILE);
    cacheMtime = stat.mtimeMs;
    cacheSize = stat.size;
  } catch {}
  return cache;
}

function writeMemory(entries) {
  ensureDir();
  const tmp = MEMORY_FILE + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, MEMORY_FILE);
  cache = entries;
  try {
    const stat = fs.statSync(MEMORY_FILE);
    cacheMtime = stat.mtimeMs;
    cacheSize = stat.size;
  } catch {}
}

export function memoryStats() {
  const entries = loadMemory();
  const tags = new Set();
  for (const entry of entries) for (const tag of entry.tags || []) tags.add(tag);
  return {
    total: entries.length,
    tags: [...tags].sort(),
    updatedAt: entries.reduce((max, entry) => Math.max(max, Number(entry.updatedAt) || 0), 0),
  };
}

export function getMemory(id) {
  return loadMemory().find((entry) => entry.id === id) ?? null;
}

export function listMemory({ query = "", limit = 20, tag = "" } = {}) {
  const entries = loadMemory();
  const q = String(query || "").trim().toLowerCase();
  const tagFilter = String(tag || "").trim().toLowerCase();
  let rows = entries;
  if (tagFilter) {
    rows = rows.filter((entry) => (entry.tags || []).some((item) => String(item).toLowerCase() === tagFilter));
  }
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    rows = rows
      .map((entry) => {
        const haystack = `${entry.title}\n${entry.text}\n${(entry.tags || []).join(" ")}\n${entry.source || ""}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (!haystack.includes(term)) continue;
          score += 2;
          if (String(entry.title).toLowerCase().includes(term)) score += 2;
          if ((entry.tags || []).some((item) => String(item).toLowerCase().includes(term))) score += 1;
        }
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || (b.entry.updatedAt || 0) - (a.entry.updatedAt || 0))
      .map((item) => item.entry);
  } else {
    rows = rows.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return rows.slice(0, Math.min(Math.max(Number(limit) || 20, 1), 100));
}

export function addMemory({ title = "", text = "", tags = [], source = "manual", scope = "shared" } = {}) {
  const content = String(text || "").trim();
  if (content === "") throw new Error("记忆内容不能为空");
  const entries = loadMemory();
  const normalized = content.replace(/\s+/g, " ").toLowerCase();
  const duplicate = entries.find((entry) => String(entry.text || "").replace(/\s+/g, " ").toLowerCase() === normalized);
  if (duplicate) return duplicate;
  const now = Date.now();
  const entry = {
    id: "m-" + now.toString(36) + "-" + crypto.randomBytes(3).toString("hex"),
    title: String(title || content.slice(0, 24)).trim(),
    text: content,
    tags: [...new Set((Array.isArray(tags) ? tags : String(tags).split(/[,，\s]+/)).map((item) => String(item).trim()).filter(Boolean))],
    source: String(source || "manual"),
    scope: String(scope || "shared"),
    createdAt: now,
    updatedAt: now,
  };
  entries.push(entry);
  writeMemory(entries);
  return entry;
}

export function removeMemory(id) {
  const entries = loadMemory();
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) return false;
  writeMemory(next);
  return true;
}

export function formatMemoryForPrompt(entries) {
  return entries
    .map((entry, index) => `${index + 1}. [${entry.title}] ${entry.text}${entry.source ? `（来源：${entry.source}）` : ""}`)
    .join("\n");
}

export function reloadMemory() {
  cache = null;
  return loadMemory();
}
