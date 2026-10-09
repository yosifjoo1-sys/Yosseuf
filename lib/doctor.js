// Project Doctor: بيفحص المشروع ويطلع الأخطاء الحقيقية (مكتبات ناقصة، أخطاء صياغة، ملفات مفقودة، مفاتيح مكشوفة).
import fs from "fs";
import path from "path";
import { builtinModules } from "module";
import { execFileSync } from "child_process";
import { resolveInWorkspace } from "./security.js";
import { walk, isBinary } from "./fsutil.js";

const BUILTIN = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, "")]));
const KEY_RE = [
  [/(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic"],
  [/(?<![A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{32,}/, "OpenAI"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google"],
  [/(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}/, "GitHub"],
  [/(?<![0-9])\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/, "Telegram"],
];

export function scanSecrets(project) {
  const dir = resolveInWorkspace(project);
  const hits = [];
  for (const f of walk(dir, { max: 1000 })) {
    if (isBinary(f)) continue;
    let txt;
    try {
      const p = path.join(dir, f);
      if (fs.statSync(p).size > 1_000_000) continue;
      txt = fs.readFileSync(p, "utf8");
    } catch { continue; }
    txt.split("\n").forEach((ln, i) => { for (const [re, kind] of KEY_RE) if (re.test(ln)) hits.push({ file: f, line: i + 1, kind }); });
  }
  return hits;
}

const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"]);
const IMPORT_RE = /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

function pkgName(spec) {
  const p = spec.split("/");
  return spec.startsWith("@") ? p.slice(0, 2).join("/") : p[0];
}
function resolveRel(fromFile, spec, set) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  const cands = [base, ...[".js", ".mjs", ".cjs", ".jsx", ".json"].map((e) => base + e), ...["index.js", "index.mjs", "index.json"].map((i) => path.posix.join(base, i))];
  return cands.some((c) => set.has(c));
}

export function diagnose(project) {
  const dir = resolveInWorkspace(project);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error("المشروع مش موجود: " + project);
  const files = walk(dir, { max: 800, includeSecret: true });
  const set = new Set(files);
  const F = [];
  const add = (level, file, msg, fix) => F.push({ level, file, msg, ...(fix ? { fix } : {}) });
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

  // package.json
  let pkg = null;
  if (set.has("package.json")) {
    try { pkg = JSON.parse(read("package.json")); }
    catch (e) { add("error", "package.json", "ملف JSON غير صالح: " + e.message); }
  }
  const deps = new Set(Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.peerDependencies, ...pkg?.optionalDependencies }));

  // إعدادات ريبليت اللي بتبوّظ التشغيل
  for (const cfg of [".replit"]) {
    if (set.has(cfg)) {
      const t = read(cfg);
      if ((t.includes("@workspace") || t.includes("pnpm --filter")) && !set.has("pnpm-workspace.yaml")) {
        add("error", cfg, "الملف مضبوط على pnpm workspace بس المشروع مفيهوش pnpm-workspace.yaml، فالتشغيل هيفشل.", 'استبدله بـ: modules = ["nodejs-22"] و run = "npm start"');
      }
    }
  }

  let jsChecked = 0, pyChecked = 0, pyMissing = false;
  const missingDeps = new Map();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    let text = null;
    const getText = () => (text ??= (() => { try { return fs.statSync(path.join(dir, f)).size > 1_000_000 ? "" : read(f); } catch { return ""; } })());

    if ([".js", ".mjs", ".cjs"].includes(ext) && jsChecked < 150) {
      jsChecked++;
      try { execFileSync(process.execPath, ["--check", path.join(dir, f)], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }); }
      catch (e) {
        const msg = String(e.stderr || e.message).split(dir).join(".").split("\n").filter(Boolean).slice(0, 4).join(" | ").slice(0, 400);
        add("error", f, "خطأ صياغة: " + msg,
          /Cannot use import statement|Unexpected token 'export'/.test(msg) ? 'ضيف "type": "module" في package.json أو استخدم require' : undefined);
      }
    }
    if (CODE_EXT.has(ext)) {
      const t = getText();
      for (const m of t.matchAll(IMPORT_RE)) {
        const spec = m[1];
        if (spec.startsWith(".")) {
          if ([".js", ".mjs", ".cjs", ".jsx"].includes(ext) && !resolveRel(f, spec, set)) add("error", f, `الملف المستورد مش موجود: ${spec}`);
        } else if (!spec.startsWith("/") && !spec.startsWith("node:") && !/^(https?:|data:|@\/|~)/.test(spec)) {
          const n = pkgName(spec);
          if (!BUILTIN.has(n) && !BUILTIN.has(spec) && !deps.has(n) && !missingDeps.has(n)) missingDeps.set(n, f);
        }
      }
    }
    if (ext === ".html" || ext === ".htm") {
      for (const m of getText().matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const u = m[1];
        if (/^(https?:|\/\/|data:|mailto:|tel:|javascript:|#)/i.test(u)) continue;
        if (u.startsWith("/")) { add("warn", f, `مسار مطلق (${u}) هيتكسر في المعاينة والنشر في مجلد فرعي`, "استخدم مسار نسبي بدون / في الأول"); continue; }
        const clean = path.posix.normalize(path.posix.join(path.posix.dirname(f), u.split(/[?#]/)[0]));
        if (clean && !clean.endsWith("/") && !set.has(clean)) add("error", f, `ملف مرتبط مش موجود: ${u}`);
      }
    }
    if (ext === ".py" && pyChecked < 100 && !pyMissing) {
      pyChecked++;
      try { execFileSync("python3", ["-c", "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())", path.join(dir, f)], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }); }
      catch (e) {
        if (e.code === "ENOENT") { pyMissing = true; add("info", f, "python3 مش موجود هنا، فحص بايثون اتخطى"); }
        else add("error", f, "خطأ صياغة بايثون: " + String(e.stderr || e.message).split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 300));
      }
    }
  }
  for (const [n, f] of missingDeps) {
    add("error", f, pkg ? `المكتبة "${n}" مستخدمة بس مش متسجلة في package.json` : `المكتبة "${n}" مستخدمة ومفيش package.json`, `ضيفها في dependencies (npm install ${n})`);
  }
  if (pkg && !pkg.scripts?.start && !pkg.main && !set.has("index.js") && !set.has("server.js")) add("warn", "package.json", 'مفيش scripts.start، منصات الاستضافة مش هتعرف تشغّله');
  if (set.has(".env")) add("warn", ".env", "فيه .env: بيتجاهل تلقائياً عند الرفع (GitHub/Vercel)", set.has(".gitignore") && read(".gitignore").includes(".env") ? undefined : "ضيف .env في .gitignore");
  for (const h of scanSecrets(project)) add("error", h.file, `مفتاح ${h.kind} مكتوب جوه الكود (سطر ${h.line})`, "شيله وحطه في متغير بيئة، وبدّل المفتاح لأنه اتكشف");

  const errors = F.filter((x) => x.level === "error").length, warnings = F.filter((x) => x.level === "warn").length;
  return { ok: errors === 0, errors, warnings, files_scanned: files.length, findings: F.slice(0, 60) };
}
