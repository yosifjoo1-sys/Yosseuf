import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { WORKSPACE } from "../lib/store.js";
const { server } = await import("../server.js");
const { previewKey } = await import("../lib/security.js");

let base;
test.before(async () => { await new Promise((r) => server.listen(0, "127.0.0.1", r)); base = "http://127.0.0.1:" + server.address().port; });
test.after(() => server.close());
const H = { "x-access-token": "test-token-123456", "content-type": "application/json" };

test("الواجهة بتفتح، والـ API مقفول من غير رمز", async () => {
  assert.strictEqual((await fetch(base + "/")).status, 200);
  assert.strictEqual((await fetch(base + "/api/state")).status, 401);
  assert.strictEqual((await fetch(base + "/api/state", { headers: { "x-access-token": "wrong" } })).status, 401);
  const r = await fetch(base + "/api/state", { headers: H });
  const j = await r.json();
  assert.ok(j.ok && Array.isArray(j.log) && j.keys.claude === true);
  assert.ok(!JSON.stringify(j).includes("sk-ant-test"), "المفتاح مايتبعتش للمتصفح");
});

test("المعاينة: مفتاح في الرابط + sandbox + حماية المسارات والأسرار", async () => {
  fs.mkdirSync(path.join(WORKSPACE, "demo"), { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE, "demo/index.html"), "<html><head></head><body>hi</body></html>");
  fs.writeFileSync(path.join(WORKSPACE, "demo/.env"), "SECRET=1");
  const k = previewKey();
  const ok = await fetch(`${base}/p/${k}/demo/`);
  assert.strictEqual(ok.status, 200);
  assert.match(ok.headers.get("content-security-policy"), /sandbox/);
  assert.match(await ok.text(), /localStorage/);          // الـ shim اتحقن
  assert.strictEqual((await fetch(`${base}/p/wrongkey/demo/`)).status, 404);
  assert.strictEqual((await fetch(`${base}/p/${k}/demo/.env`)).status, 404);
  assert.strictEqual((await fetch(`${base}/p/${k}/demo/..%2f..%2fdata%2faccess-token.txt`)).status, 404);
  assert.strictEqual((await fetch(`${base}/p/${k}/%2e%2e/data/session.json`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/file?path=demo/.env`, { headers: H })).status, 404);
  const trav = await fetch(`${base}/api/file?path=${encodeURIComponent("../data/access-token.txt")}`, { headers: H });
  assert.ok(trav.status >= 400);
});

test("API: وضع التحكم والموافقة على طلب مش موجود", async () => {
  const m = await (await fetch(base + "/api/mode", { method: "POST", headers: H, body: JSON.stringify({ mode: "strict" }) })).json();
  assert.ok(m.ok);
  const bad = await (await fetch(base + "/api/mode", { method: "POST", headers: H, body: JSON.stringify({ mode: "hack" }) })).json();
  assert.strictEqual(bad.ok, false);
  const d = await (await fetch(base + "/api/decide", { method: "POST", headers: H, body: JSON.stringify({ id: "nope", approve: true }) })).json();
  assert.strictEqual(d.ok, false);
});
