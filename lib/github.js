import fs from "fs";
import path from "path";
import { resolveInWorkspace } from "./security.js";
import { walk } from "./fsutil.js";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
async function api(p, opts = {}) {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN مش متضاف (Secrets أو .env)");
  const r = await fetch("https://api.github.com" + p, {
    ...opts, signal: AbortSignal.timeout(60000),
    headers: { authorization: `Bearer ${t}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "mrjoo-commander", "content-type": "application/json", ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !(opts.allow404 && r.status === 404)) throw new Error(`GitHub ${r.status}: ${j.message || "خطأ"}`);
  return { status: r.status, body: j };
}
const needRepo = (repo) => { if (!REPO_RE.test(repo || "")) throw new Error("اسم الريبو لازم owner/name"); };

export async function listRepos() {
  const { body } = await api("/user/repos?per_page=50&sort=updated");
  return body.map((r) => ({ repo: r.full_name, private: r.private, updated: r.updated_at, description: r.description }));
}
export async function readFile(repo, p, ref) {
  needRepo(repo);
  if (String(p || "").split("/").includes("..")) throw new Error("مسار غير صالح");
  const { body } = await api(`/repos/${repo}/contents/${(p || "").split("/").map(encodeURIComponent).join("/")}${ref ? "?ref=" + encodeURIComponent(ref) : ""}`);
  if (Array.isArray(body)) return { type: "dir", entries: body.map((e) => ({ name: e.name, type: e.type })) };
  const text = Buffer.from(body.content || "", "base64").toString("utf8");
  return { type: "file", truncated: text.length > 80000, content: text.slice(0, 80000) };
}
export async function createRepo(name, isPrivate = true, description = "") {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name || "")) throw new Error("اسم ريبو غير صالح");
  const { body } = await api("/user/repos", { method: "POST", body: JSON.stringify({ name, private: isPrivate, description, auto_init: true }) });
  return { repo: body.full_name, url: body.html_url, private: body.private, default_branch: body.default_branch };
}
export async function pushProject(repo, project, message, branch) {
  needRepo(repo);
  const dir = resolveInWorkspace(project);
  const files = walk(dir, { max: 100 });
  if (!files.length) throw new Error("المشروع فاضي");
  if (!branch) branch = (await api(`/repos/${repo}`)).body.default_branch;
  const pushed = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    if (buf.length > 1_000_000) continue;
    const url = `/repos/${repo}/contents/${f.split("/").map(encodeURIComponent).join("/")}`;
    const cur = await api(`${url}?ref=${encodeURIComponent(branch)}`, { allow404: true });
    await api(url, { method: "PUT", body: JSON.stringify({ message: message || "update from MR JOO Commander", content: buf.toString("base64"), branch, ...(cur.status === 200 ? { sha: cur.body.sha } : {}) }) });
    pushed.push(f);
  }
  return { repo, branch, pushed: pushed.length, url: `https://github.com/${repo}/tree/${branch}` };
}
