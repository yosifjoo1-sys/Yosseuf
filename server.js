import http from "http";
import fs from "fs";
import path from "path";
import { loadEnv } from "./lib/env.js";
import { APP, WORKSPACE } from "./lib/store.js";
loadEnv();
const { accessToken, tokenWasGenerated, previewKey, safeEqual, resolveInWorkspace, scrub } = await import("./lib/security.js");
const { walk, isSecretFile } = await import("./lib/fsutil.js");
const agent = await import("./lib/agent.js");
const { startTelegram } = await import("./lib/telegram.js");

const TOKEN = accessToken();
const KEY = previewKey();
const MIME = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".woff2": "font/woff2" };
const STORAGE_SHIM = `<script>try{localStorage.getItem("_")}catch(e){var mk=function(){var m=new Map();return{getItem:function(k){return m.has(k)?m.get(k):null},setItem:function(k,v){m.set(k,String(v))},removeItem:function(k){m.delete(k)},clear:function(){m.clear()},key:function(i){return Array.from(m.keys())[i]||null},get length(){return m.size}}};try{Object.defineProperty(window,"localStorage",{value:mk()});Object.defineProperty(window,"sessionStorage",{value:mk()})}catch(_){}}</script>`;

const hits = new Map(), fails = new Map();
const ipOf = (req) => (process.env.TRUST_PROXY === "1" ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "") || req.socket.remoteAddress || "?";
function rate(map, ip, max) { const now = Date.now(); const a = (map.get(ip) || []).filter((t) => now - t < 60000); if (a.length >= max) { map.set(ip, a); return false; } a.push(now); map.set(ip, a); return true; }
setInterval(() => { const now = Date.now(); for (const m of [hits, fails]) for (const [k, v] of m) if (!v.some((t) => now - t < 60000)) m.delete(k); }, 120000).unref();

const json = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(b); };
function body(req) {
  return new Promise((ok, no) => {
    let n = 0; const ch = [];
    req.on("data", (c) => { n += c.length; if (n > 1_000_000) { no(new Error("الطلب كبير")); req.destroy(); } else ch.push(c); });
    req.on("end", () => { try { ok(ch.length ? JSON.parse(Buffer.concat(ch).toString("utf8")) : {}); } catch { no(new Error("JSON غير صالح")); } });
    req.on("error", no);
  });
}
function authed(req) { return safeEqual(req.headers["x-access-token"] || "", TOKEN); }

function serveFile(res, full, { preview = false } = {}) {
  let st;
  try { st = fs.statSync(full); } catch { res.writeHead(404); return res.end("not found"); }
  if (st.isDirectory()) full = path.join(full, "index.html");
  if (!fs.existsSync(full)) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("مفيش index.html في المشروع ده"); }
  const ext = path.extname(full).toLowerCase();
  const headers = { "content-type": MIME[ext] || "application/octet-stream", "x-content-type-options": "nosniff", "cache-control": "no-store", "referrer-policy": "no-referrer" };
  if (preview) headers["content-security-policy"] = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads";
  else headers["x-frame-options"] = "DENY";
  if (preview && ext === ".html") {
    let t = fs.readFileSync(full, "utf8");
    t = /<head[^>]*>/i.test(t) ? t.replace(/<head[^>]*>/i, (m) => m + STORAGE_SHIM) : STORAGE_SHIM + t;
    headers["content-length"] = Buffer.byteLength(t); res.writeHead(200, headers); return res.end(t);
  }
  headers["content-length"] = st.isDirectory() ? 0 : fs.statSync(full).size;
  res.writeHead(200, headers); fs.createReadStream(full).pipe(res);
}

function projects() {
  return fs.readdirSync(WORKSPACE, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => {
    const dir = path.join(WORKSPACE, e.name);
    return { name: e.name, files: walk(dir, { max: 2000 }).length, preview: fs.existsSync(path.join(dir, "index.html")) ? `/p/${KEY}/${encodeURIComponent(e.name)}/` : null };
  });
}
const keys = () => ({ claude: !!process.env.ANTHROPIC_API_KEY, gpt: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY, github: !!process.env.GITHUB_TOKEN, vercel: !!process.env.VERCEL_TOKEN, telegram: !!process.env.TELEGRAM_BOT_TOKEN, image: !!(process.env.IMAGE_API_KEY), video: !!process.env.VIDEO_API_KEY });

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const ip = ipOf(req);

    if (req.method === "GET" && (p === "/" || p === "/index.html")) return serveFile(res, path.join(APP, "public", "index.html"));

    if (p.startsWith("/p/")) {                       // معاينة المشاريع: مفتاح معاينة في الرابط، وبيئة معزولة (sandbox)
      if (req.method !== "GET") { res.writeHead(405); return res.end(); }
      const parts = p.split("/").slice(2);
      if (!safeEqual(parts[0] || "", KEY)) { res.writeHead(404); return res.end("not found"); }
      let rest; try { rest = parts.slice(1).map(decodeURIComponent); } catch { res.writeHead(400); return res.end(); }
      if (!rest[0]) { res.writeHead(404); return res.end(); }
      if (rest.length === 1 && !p.endsWith("/")) { res.writeHead(302, { location: p + "/" }); return res.end(); }
      if (rest.some((s) => s === ".." || s.startsWith(".") || s.includes("\0") || isSecretFile(s))) { res.writeHead(404); return res.end("not found"); }
      let full; try { full = resolveInWorkspace(rest.filter(Boolean).join("/")); } catch { res.writeHead(404); return res.end(); }
      return serveFile(res, full, { preview: true });
    }

    if (!p.startsWith("/api/")) { res.writeHead(404); return res.end("not found"); }
    if (!rate(hits, ip, 120)) return json(res, 429, { ok: false, error: "طلبات كتير، استنى شوية" });
    if (!authed(req)) { if (!rate(fails, ip, 10)) return json(res, 429, { ok: false, error: "محاولات كتير غلط، استنى دقيقة" }); return json(res, 401, { ok: false, error: "unauthorized" }); }

    if (req.method === "GET" && p === "/api/state") {
      const s = agent.state;
      return json(res, 200, { ok: true, busy: s.busy, mode: s.mode, log: s.log.slice(-150), pending: s.pending.map((x) => ({ id: x.id, tool: x.tool, summary: x.summary, detail: scrub(JSON.stringify(x.input, null, 1)).slice(0, 1500) })), projects: projects(), keys: keys() });
    }
    if (req.method === "GET" && p === "/api/files") {
      const dir = resolveInWorkspace(url.searchParams.get("project") || ""); return json(res, 200, { ok: true, files: walk(dir, { max: 500 }) });
    }
    if (req.method === "GET" && p === "/api/file") {
      const rel = url.searchParams.get("path") || ""; const full = resolveInWorkspace(rel);
      if (isSecretFile(path.basename(full)) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return json(res, 404, { ok: false, error: "مش موجود" });
      if (fs.statSync(full).size > 300000) return json(res, 413, { ok: false, error: "الملف كبير" });
      return json(res, 200, { ok: true, content: scrub(fs.readFileSync(full, "utf8")) });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method" });
    const b = await body(req);
    if (p === "/api/chat") { await agent.send(b.message, "web"); return json(res, 200, { ok: true }); }
    if (p === "/api/decide") { await agent.decide(String(b.id), !!b.approve); return json(res, 200, { ok: true }); }
    if (p === "/api/mode") { agent.setMode(b.mode); return json(res, 200, { ok: true }); }
    if (p === "/api/stop") { agent.stop(); return json(res, 200, { ok: true }); }
    if (p === "/api/reset") { agent.reset(); return json(res, 200, { ok: true }); }
    return json(res, 404, { ok: false, error: "not found" });
  } catch (e) { json(res, 400, { ok: false, error: scrub(e.message) }); }
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(APP, "server.js")) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, process.env.HOST || "0.0.0.0", () => {
    console.log(`\nMR JOO COMMANDER شغال على http://localhost:${port}`);
    if (tokenWasGenerated()) console.log(`رمز الدخول (اتولّد تلقائياً): ${TOKEN}\n(متخزن في data/access-token.txt)`);
    else console.log("رمز الدخول: اللي في ACCESS_TOKEN");
    if (!process.env.ANTHROPIC_API_KEY) console.log("⚠️ ضيف ANTHROPIC_API_KEY عشان الوكيل يشتغل.");
    startTelegram();
  });
}
