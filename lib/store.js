import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = process.env.MRJOO_HOME ? path.resolve(process.env.MRJOO_HOME) : process.env.VERCEL ? "/tmp/mrjoo" : APP;
export const DATA = path.join(ROOT, "data");
export const WORKSPACE = path.join(ROOT, "workspace");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(WORKSPACE, { recursive: true });

export function loadJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); } catch { return fallback; }
}
export function saveJSON(name, obj) {
  const f = path.join(DATA, name);
  fs.writeFileSync(f + ".tmp", JSON.stringify(obj, null, 2));
  fs.renameSync(f + ".tmp", f);
}
export const safeOwner = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
