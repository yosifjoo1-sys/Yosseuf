import fs from "fs";
import path from "path";
export const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".next", "dist", ".cache", ".local", ".upm"]);
export const isSecretFile = (name) => name === ".env" || (name.startsWith(".env.") && !/\.(example|sample|template)$/.test(name));
const BIN = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".mp4", ".webm", ".wav", ".ogg", ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".zip"]);
export const isBinary = (f) => BIN.has(path.extname(f).toLowerCase());

export function walk(dir, { max = 500, includeSecret = false } = {}) {
  const out = [];
  (function rec(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      if (out.length >= max) return;
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) rec(p); }
      else if (e.isFile()) {
        if (!includeSecret && isSecretFile(e.name)) continue;
        out.push(path.relative(dir, p).split(path.sep).join("/"));
      }
    }
  })(dir);
  return out;
}
