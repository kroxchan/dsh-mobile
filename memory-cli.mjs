#!/usr/bin/env node
/**
 * 共享记忆 CLI：
 *   node memory-cli.mjs list [limit]
 *   node memory-cli.mjs search "关键词" [limit]
 *   node memory-cli.mjs add "标题" "内容" [标签,逗号分隔]
 *   node memory-cli.mjs stats
 */
import { listMemory, addMemory, memoryStats, formatMemoryForPrompt } from "./memory-store.mjs";

const [command = "list", ...args] = process.argv.slice(2);
if (command === "search") {
  const query = args[0] ?? "";
  const rows = listMemory({ query, limit: Number(args[1]) || 20 });
  console.log(rows.length ? formatMemoryForPrompt(rows) : "没有匹配的记忆。");
} else if (command === "add") {
  const [title = "", text = "", tags = ""] = args;
  if (!text.trim()) {
    console.error("用法: node memory-cli.mjs add \"标题\" \"内容\" [标签]");
    process.exit(1);
  }
  const item = addMemory({
    title,
    text,
    tags: tags.split(/[,，\s]+/).filter(Boolean),
    source: "dsh-agent",
    scope: "shared",
  });
  console.log(`已写入 ${item.id}: ${item.title}`);
} else if (command === "stats") {
  console.log(JSON.stringify(memoryStats(), null, 2));
} else {
  const rows = listMemory({ limit: Number(args[0]) || 30 });
  console.log(rows.length ? formatMemoryForPrompt(rows) : "共享知识库为空。");
}
