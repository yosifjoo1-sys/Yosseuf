// قراءة ملف .env بدون أي مكتبة. متغيرات البيئة الفعلية (Secrets) ليها الأولوية.
import fs from "fs";
import path from "path";
import { APP } from "./store.js";
export function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(APP, ".env"), "utf8").split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch { /* مفيش .env، عادي */ }
}
