#!/usr/bin/env node
/**
 * 生成 dsh-mobile 的配置：随机访问口令 + 门 cookie 签名密钥。
 * 口令只在这里打印一次，磁盘上只保存 scrypt 派生值。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(DIR, "config.json");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomPasscode(groups = 3, size = 4) {
  const out = [];
  for (let g = 0; g < groups; g += 1) {
    let chunk = "";
    for (let i = 0; i < size; i += 1) chunk += ALPHABET[crypto.randomInt(ALPHABET.length)];
    out.push(chunk);
  }
  return out.join("-");
}

const passcode = process.argv[2] ?? randomPasscode();
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(passcode, salt, 64);
const gateSecret = crypto.randomBytes(32);

const config = {
  listenPort: 19000,
  upstreamPort: 61324,
  passSalt: salt.toString("hex"),
  passHash: hash.toString("hex"),
  gateSecret: gateSecret.toString("base64url"),
  createdAt: new Date().toISOString(),
};

fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(`配置已写入 ${CONFIG_PATH}`);
console.log(`手机访问口令: ${passcode}`);
