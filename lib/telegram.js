// تليجرام (اختياري): نفس الوكيل، والموافقات بأزرار ✅/❌. مقفول على IDs المسموحة بس.
import * as agent from "./agent.js";
import { speechToText } from "./media.js";

export function startTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return console.log("تليجرام: مفيش TELEGRAM_BOT_TOKEN، متخطي.");
  const allowed = (process.env.TELEGRAM_ALLOWED_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return console.log("تليجرام: لازم تحط TELEGRAM_ALLOWED_IDS (الـ ID بتاعك) عشان ما حدش غريب يتحكم. متخطي.");
  const api = (m) => `https://api.telegram.org/bot${token}/${m}`;
  const call = async (m, b) => (await fetch(api(m), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();
  const ok = (id) => allowed.includes(String(id));
  const sendText = async (chat, text, extra = {}) => { for (let i = 0; i < Math.max(text.length, 1); i += 4000) await call("sendMessage", { chat_id: chat, text: text.slice(i, i + 4000), ...extra }); };

  let q = Promise.resolve();
  agent.on((e) => {
    const chat = agent.state.tgChat;
    if (agent.state.origin !== "tg" || !chat) return;
    q = q.then(async () => {
      if (e.role === "agent") await sendText(chat, e.text);
      else if (e.role === "error") await sendText(chat, "⚠️ " + e.text);
      else if (e.role === "approval") await sendText(chat, "🔐 محتاج موافقتك:\n" + e.text, { reply_markup: { inline_keyboard: [[{ text: "✅ موافق", callback_data: "ok:" + e.pendingId }, { text: "❌ رفض", callback_data: "no:" + e.pendingId }]] } });
    }).catch((err) => console.error("tg:", err.message));
  });

  async function onMessage(msg) {
    const chat = msg.chat.id;
    if (!ok(msg.from?.id)) return sendText(chat, "البوت ده خاص.");
    agent.state.tgChat = chat;
    let text = msg.text;
    try {
      if (text === "/start") return sendText(chat, "أهلاً، أنا MR JOO COMMANDER. قولي عايز تبني إيه، وأي حاجة حساسة هستأذنك فيها.\n/mode strict = أستأذنك في كل كتابة\n/mode normal = الحذف والنشر بس\n/reset = صفحة جديدة");
      if (text === "/reset") { agent.reset(); return sendText(chat, "تمام، صفحة جديدة."); }
      if (text?.startsWith("/mode")) { agent.setMode(text.split(/\s+/)[1]); return sendText(chat, "الوضع: " + agent.state.mode); }
      if (msg.voice || msg.audio) {
        const f = await (await fetch(api("getFile") + "?file_id=" + (msg.voice || msg.audio).file_id)).json();
        const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`)).arrayBuffer());
        text = await speechToText(buf);
        if (!text) return sendText(chat, "لازم STT_API_KEY عشان أسمع الصوت. ابعت كتابة.");
      }
      if (!text) return;
      await agent.send(text, "tg");
    } catch (e) { await sendText(chat, "⚠️ " + e.message); }
  }
  async function onCallback(cb) {
    if (!ok(cb.from?.id)) return;
    await call("answerCallbackQuery", { callback_query_id: cb.id });
    const [act, id] = String(cb.data || "").split(":");
    agent.state.tgChat = cb.message?.chat?.id || agent.state.tgChat;
    try { await agent.decide(id, act === "ok"); } catch (e) { await sendText(agent.state.tgChat, "⚠️ " + e.message); }
  }

  (async function poll(offset = 0) {
    try {
      const r = await (await fetch(api("getUpdates") + `?timeout=30&offset=${offset}`)).json();
      for (const u of r.result || []) {
        offset = u.update_id + 1;
        if (u.message) onMessage(u.message).catch((e) => console.error("tg:", e.message));
        if (u.callback_query) onCallback(u.callback_query).catch((e) => console.error("tg:", e.message));
      }
    } catch { await new Promise((s) => setTimeout(s, 3000)); }
    setImmediate(() => poll(offset));
  })();
  console.log("تليجرام: شغال (polling).");
}
