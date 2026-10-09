import fs from "fs";
import path from "path";
import { resolveInWorkspace } from "./security.js";
import { walk, isBinary } from "./fsutil.js";

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "mrjoo-site";

export async function deploy(project, name, production = true) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN مش متضاف (Secrets أو .env)");
  const dir = resolveInWorkspace(project);
  const list = walk(dir, { max: 300 }).filter((f) => !f.endsWith(".bak"));
  if (!list.length) throw new Error("المشروع فاضي");
  let total = 0;
  const files = list.map((f) => {
    const buf = fs.readFileSync(path.join(dir, f));
    total += buf.length;
    return isBinary(f) ? { file: f, data: buf.toString("base64"), encoding: "base64" } : { file: f, data: buf.toString("utf8") };
  });
  if (total > 10_000_000) throw new Error("حجم الملفات أكبر من 10MB");
  const team = process.env.VERCEL_TEAM_ID ? `&teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  const r = await fetch(`https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1${team}`, {
    method: "POST", signal: AbortSignal.timeout(120000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: slug(name || project), files, projectSettings: { framework: null }, ...(production ? { target: "production" } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Vercel ${r.status}: ${j.error?.message || "فشل النشر"}`);
  return { url: `https://${j.url}`, state: j.readyState, files: files.length, production };
}
