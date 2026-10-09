import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { WORKSPACE } from "../lib/store.js";
import * as agent from "../lib/agent.js";

// Claude مزيف: ردود جاهزة. وبنتأكد إن كل tool_use ليه tool_result قبل أي طلب جديد.
const script = [];
const seen = [];
globalThis.fetch = async (url, opts) => {
  assert.ok(String(url).includes("api.anthropic.com"), "طلب لجهة غير متوقعة: " + url);
  const b = JSON.parse(opts.body);
  seen.push(b.messages);
  const msgs = b.messages;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const ids = m.content.filter((x) => x.type === "tool_use").map((x) => x.id);
      if (ids.length) {
        const next = msgs[i + 1];
        assert.ok(next && next.role === "user" && Array.isArray(next.content), "tool_use من غير tool_result");
        for (const id of ids) assert.ok(next.content.some((c) => c.tool_use_id === id), "ناقص نتيجة للأداة " + id);
      }
    }
  }
  const r = script.shift();
  return { ok: true, status: 200, json: async () => r };
};
const wait = async (cond, ms = 4000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((s) => setTimeout(s, 20)); } };
const tu = (id, name, input) => ({ type: "tool_use", id, name, input });

test("وكيل: يكتب لوحده، ويقف عند الحذف لحد ما توافق", async () => {
  script.push(
    { stop_reason: "tool_use", content: [{ type: "text", text: "هبني الصفحة" }, tu("t1", "write_file", { path: "site/index.html", content: "<h1>hi</h1>" }), tu("t2", "delete_path", { path: "site/old.txt" })] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "خلصت." }] },
  );
  fs.mkdirSync(path.join(WORKSPACE, "site"), { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE, "site/old.txt"), "old");
  await agent.send("ابني صفحة وامسح القديم");
  await wait(() => !agent.state.busy && agent.state.pending.length === 1);
  assert.ok(fs.existsSync(path.join(WORKSPACE, "site/index.html")), "الكتابة لازم تتنفذ تلقائياً");
  assert.ok(fs.existsSync(path.join(WORKSPACE, "site/old.txt")), "الحذف مايتنفذش قبل الموافقة");
  await assert.rejects(() => agent.send("كمان"), /موافقة/);
  await agent.decide(agent.state.pending[0].id, true);
  await wait(() => !agent.state.busy && script.length === 0);
  assert.ok(!fs.existsSync(path.join(WORKSPACE, "site/old.txt")), "بعد الموافقة اتحذف");
  assert.ok(agent.state.log.some((e) => e.role === "agent" && e.text === "خلصت."));
});

test("وكيل: الرفض بيمنع التنفيذ وبيوصل للنموذج", async () => {
  script.push(
    { stop_reason: "tool_use", content: [tu("d1", "delete_path", { path: "site/index.html" })] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "تمام، مش هحذف." }] },
  );
  await agent.send("امسح الصفحة");
  await wait(() => !agent.state.busy && agent.state.pending.length === 1);
  await agent.decide(agent.state.pending[0].id, false);
  await wait(() => !agent.state.busy && script.length === 0);
  assert.ok(fs.existsSync(path.join(WORKSPACE, "site/index.html")), "الرفض لازم يحمي الملف");
  const last = seen[seen.length - 1];
  const tr = last[last.length - 1].content[0];
  assert.match(tr.content, /رفض/);
});

test("وكيل: الوضع الصارم بيستأذن حتى في الكتابة، والـ precheck بيمنع النشر لو فيه مفتاح", async () => {
  agent.setMode("strict");
  script.push(
    { stop_reason: "tool_use", content: [tu("w1", "write_file", { path: "site/a.txt", content: "x" })] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
  );
  await agent.send("اكتب ملف");
  await wait(() => !agent.state.busy && agent.state.pending.length === 1);
  assert.ok(!fs.existsSync(path.join(WORKSPACE, "site/a.txt")));
  await agent.decide(agent.state.pending[0].id, true);
  await wait(() => !agent.state.busy && script.length === 0);
  assert.ok(fs.existsSync(path.join(WORKSPACE, "site/a.txt")));
  agent.setMode("normal");

  fs.writeFileSync(path.join(WORKSPACE, "site/k.js"), 'const k="' + "sk-ant-" + "zzzzzzzzzzzzzzzzzzzzzzzz" + '"');
  script.push(
    { stop_reason: "tool_use", content: [tu("v1", "vercel_deploy", { project: "site" })] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "لقيت مفتاح." }] },
  );
  await agent.send("انشر");
  await wait(() => !agent.state.busy && script.length === 0);
  assert.strictEqual(agent.state.pending.length, 0, "مفيش موافقة تتطلب لأن النشر اتمنع قبلها");
  const last = seen[seen.length - 1];
  assert.match(last[last.length - 1].content[0].content, /مفتاح سري/);
});
