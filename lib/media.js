// توليد صور (OpenAI Images) وفيديو (Replicate) وصوت (ElevenLabs / OpenAI) وتحويل صوت لنص.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { WORKSPACE, safeOwner } from "./store.js";

const env = (k, d = "") => process.env[k] || d;

function saveMedia(owner, buf, ext) {
  const o = safeOwner(owner);
  const name = `media/${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${ext}`;
  const full = path.join(WORKSPACE, o, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return { path: full, url: `/files/${o}/${name}` };
}

export async function generateImage(owner, prompt) {
  const key = env("IMAGE_API_KEY");
  if (!key) throw new Error("مفتاح الصور IMAGE_API_KEY مش متضاف في .env");
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: env("IMAGE_MODEL", "gpt-image-1"), prompt, size: "1024x1024" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "فشل توليد الصورة");
  const d = j.data?.[0];
  let buf;
  if (d?.b64_json) buf = Buffer.from(d.b64_json, "base64");
  else if (d?.url) buf = Buffer.from(await (await fetch(d.url)).arrayBuffer());
  else throw new Error("المزود مرجعش صورة");
  return { kind: "image", ...saveMedia(owner, buf, "png") };
}

export async function generateVideo(owner, prompt) {
  const key = env("VIDEO_API_KEY");
  const model = env("VIDEO_MODEL", "minimax/video-01");
  if (!key) throw new Error("مفتاح الفيديو VIDEO_API_KEY (Replicate) مش متضاف في .env");
  const h = { "content-type": "application/json", authorization: `Bearer ${key}` };
  let r = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST", headers: h, body: JSON.stringify({ input: { prompt } }),
  });
  let j = await r.json();
  if (!r.ok) throw new Error(j.detail || "فشل بدء توليد الفيديو");
  const t0 = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(j.status)) {
    if (Date.now() - t0 > 6 * 60 * 1000) throw new Error("توليد الفيديو أخد وقت طويل");
    await new Promise((s) => setTimeout(s, 4000));
    j = await (await fetch(j.urls.get, { headers: h })).json();
  }
  if (j.status !== "succeeded") throw new Error(j.error || "فشل توليد الفيديو");
  const out = Array.isArray(j.output) ? j.output[0] : j.output;
  const buf = Buffer.from(await (await fetch(out)).arrayBuffer());
  return { kind: "video", ...saveMedia(owner, buf, "mp4") };
}

// نص -> صوت (mp3). بيرجع Buffer أو null لو مفيش مزود متضبط.
export async function textToSpeech(text) {
  const key = env("TTS_API_KEY");
  if (!key) return null;
  text = String(text).slice(0, 1500);
  const provider = env("TTS_PROVIDER", "elevenlabs");
  if (provider === "elevenlabs") {
    const voice = env("TTS_VOICE", "EXAVITQu4vr4xnSDxMaL");
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: env("TTS_MODEL", "eleven_multilingual_v2") }),
    });
    if (!r.ok) throw new Error("فشل توليد الصوت (ElevenLabs)");
    return Buffer.from(await r.arrayBuffer());
  }
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: env("TTS_MODEL", "gpt-4o-mini-tts"), voice: env("TTS_VOICE", "shimmer"), input: text,
      instructions: "تكلمي بلهجة مصرية دافئة وواثقة وهادئة، بنبرة أنثوية محترفة.",
    }),
  });
  if (!r.ok) throw new Error("فشل توليد الصوت (OpenAI)");
  return Buffer.from(await r.arrayBuffer());
}

// صوت -> نص (للرسائل الصوتية في تليجرام)
export async function speechToText(buf, filename = "voice.ogg") {
  const key = env("STT_API_KEY");
  if (!key) return null;
  const fd = new FormData();
  fd.append("file", new Blob([buf]), filename);
  fd.append("model", env("STT_MODEL", "gpt-4o-mini-transcribe"));
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { authorization: `Bearer ${key}` }, body: fd,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "فشل تحويل الصوت لنص");
  return j.text;
}
