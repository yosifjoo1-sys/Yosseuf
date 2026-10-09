import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { WORKSPACE } from "../lib/store.js";
import { resolveInWorkspace, scrub } from "../lib/security.js";
import { BY_NAME, approvalFor } from "../lib/tools.js";
import { diagnose, scanSecrets } from "../lib/doctor.js";

test("المسارات: ممنوع الخروج من workspace", () => {
  for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:\\x", "a/../.."]) assert.throws(() => resolveInWorkspace(bad), bad);
  assert.ok(resolveInWorkspace("proj/a.txt").startsWith(WORKSPACE));
});

test("scrub بيخفي المفاتيح", () => {
  assert.ok(!scrub("key=" + process.env.ANTHROPIC_API_KEY).includes("sk-ant-test"));
});

test("أدوات الملفات: كتابة، تعديل، نسخة احتياطية، استرجاع، حذف بموافقة", async () => {
  const run = (n, i) => BY_NAME[n].run(i);
  await run("write_file", { path: "app/index.html", content: "<h1>مرحبا</h1>" });
  assert.throws(() => BY_NAME.write_file.precheck({ path: "index.html", content: "x" }), /اسم_المشروع|المشروع/);
  assert.throws(() => BY_NAME.write_file.precheck({ path: "app/.env", content: "K=1" }), /ممنوع/);
  assert.throws(() => BY_NAME.write_file.precheck({ path: "../evil/x.txt", content: "x" }));
  await run("edit_file", { path: "app/index.html", old_str: "مرحبا", new_str: "أهلا" });
  assert.strictEqual(run("read_file", { path: "app/index.html" }).content, "<h1>أهلا</h1>");
  await assert.rejects(async () => run("edit_file", { path: "app/index.html", old_str: "غير موجود", new_str: "x" }), /مش موجود/);
  run("restore_file", { path: "app/index.html" });
  assert.strictEqual(run("read_file", { path: "app/index.html" }).content, "<h1>مرحبا</h1>");
  // سياسة الموافقة
  assert.strictEqual(approvalFor(BY_NAME.write_file, { path: "a/b", content: "" }, "normal"), null);
  assert.ok(approvalFor(BY_NAME.write_file, { path: "a/b", content: "" }, "strict"));
  assert.ok(approvalFor(BY_NAME.delete_path, { path: "app/index.html" }, "normal"));
  assert.ok(approvalFor(BY_NAME.vercel_deploy, { project: "app" }, "normal"));
  assert.ok(approvalFor(BY_NAME.github_push, { repo: "a/b", project: "app" }, "normal"));
  assert.strictEqual(approvalFor(BY_NAME.read_file, { path: "a/b" }, "strict"), null);
  run("delete_path", { path: "app/index.html" });
  assert.ok(!fs.existsSync(path.join(WORKSPACE, "app/index.html")));
  run("restore_file", { path: "app/index.html" });
  assert.ok(fs.existsSync(path.join(WORKSPACE, "app/index.html")));
});

test("Project Doctor بيلقط الأخطاء الحقيقية", () => {
  const d = path.join(WORKSPACE, "broken");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: "x", type: "module", dependencies: { express: "^5" } }));
  fs.writeFileSync(path.join(d, "server.js"), 'import express from "express";\nimport cors from "cors";\nimport { x } from "./nope.js";\nconsole.log(express, cors, x);\n');
  fs.writeFileSync(path.join(d, "bad.js"), "const a = ;\n");
  fs.writeFileSync(path.join(d, "index.html"), '<script src="missing.js"></script><link href="/abs.css">');
  fs.writeFileSync(path.join(d, ".replit"), 'run = "pnpm --filter @workspace/api-server run dev"');
  fs.writeFileSync(path.join(d, "leak.js"), 'const k = "' + "sk-ant-" + "a1b2c3d4e5f6g7h8i9j0k1l2" + '";\n');
  const r = diagnose("broken");
  const msgs = r.findings.map((f) => f.file + ": " + f.msg).join("\n");
  assert.strictEqual(r.ok, false);
  assert.match(msgs, /"cors"/);                 // مكتبة ناقصة
  assert.doesNotMatch(msgs, /"express"/);       // مكتبة موجودة
  assert.match(msgs, /nope\.js/);               // استيراد مفقود
  assert.match(msgs, /bad\.js: خطأ صياغة/);
  assert.match(msgs, /missing\.js/);
  assert.match(msgs, /مسار مطلق/);
  assert.match(msgs, /\.replit: .*pnpm/);       // نفس مشكلتك في ريبليت
  assert.match(msgs, /Anthropic/);              // مفتاح مكشوف
  assert.ok(!JSON.stringify(r).includes("a1b2c3d4e5f6"), "المفتاح مايظهرش في التقرير");
  assert.ok(scanSecrets("broken").length >= 1);
});

test("Project Doctor: مشروع سليم = ok", () => {
  const d = path.join(WORKSPACE, "good");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "index.html"), '<script src="app.js"></script>');
  fs.writeFileSync(path.join(d, "app.js"), "console.log(1)\n");
  assert.strictEqual(diagnose("good").ok, true);
});
