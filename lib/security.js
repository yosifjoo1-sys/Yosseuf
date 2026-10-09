import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA, WORKSPACE } from "./store.js";

function persisted(name, make) {
  const f = path.join(DATA, name);
  try { const v = fs.readFileSync(f, "utf8").trim(); if (v) return v; } catch {}
  const v = make();
  fs.writeFileSync(f, v, { mode: 0o600 });
  return v;
}
let _tok, _key, _generated = false;
export function accessToken() {
  if (_tok) return _tok;
  if (process.env.ACCESS_TOKEN) return (_tok = process.env.ACCESS_TOKEN);
  _tok = persisted("access-token.txt", () => { _generated = true; return crypto.randomBytes(18).toString("base64url"); });
  return _tok;
}
export const tokenWasGenerated = () => _generated;
export const previewKey = () => (_key ||= persisted("preview-key.txt", () => crypto.randomBytes(16).toString("hex")));

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const SECRET_ENVS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GITHUB_TOKEN", "VERCEL_TOKEN",
  "TELEGRAM_BOT_TOKEN", "ACCESS_TOKEN", "IMAGE_API_KEY", "VIDEO_API_KEY", "TTS_API_KEY", "STT_API_KEY"];
export function scrub(v) {
  let t = typeof v === "string" ? v : JSON.stringify(v) ?? "";
  for (const k of SECRET_ENVS) { const s = process.env[k]; if (s && s.length >= 8) t = t.split(s).join("***"); }
  try {
    const gen = fs.readFileSync(path.join(DATA, "access-token.txt"), "utf8").trim();
    if (gen.length >= 8) t = t.split(gen).join("***");
  } catch {}
  return t;
}

// أي مسار لازم يفضل جوه workspace.
export function cleanRel(rel) {
  if (typeof rel !== "string" || !rel.trim()) throw new Error("المسار فاضي");
  const r = rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
  if (r.includes("\0") || r.startsWith("/") || /^[a-zA-Z]:/.test(r)) throw new Error("مسار غير صالح");
  if (r.split("/").some((s) => s === "..")) throw new Error("المسار خارج مساحة العمل");
  return r;
}
export function resolveInWorkspace(rel) {
  const r = cleanRel(rel);
  const full = path.resolve(WORKSPACE, r);
  if (full !== WORKSPACE && !full.startsWith(WORKSPACE + path.sep)) throw new Error("المسار خارج مساحة العمل");
  return full;
}
