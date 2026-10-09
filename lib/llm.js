// Claude = العقل المنفّذ (بأدوات). GPT و Gemini = مستشارين متخصصين بتناديهم نورا عند اللزوم.
const T = (ms) => AbortSignal.timeout(ms);

export async function callClaude(system, messages, tools) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY مش متضاف (Secrets أو .env)");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: T(240000),
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.MODEL || "claude-sonnet-5-5", max_tokens: 8192, system, tools, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Claude API ${r.status}`);
  return j;
}

export async function askSpecialist(model, task) {
  const system = "You are a specialist consultant inside an AI coding agent. Be precise, concrete and concise. Answer in the language of the task.";
  if (model === "gpt") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY مش متضاف");
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: T(180000),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5", messages: [{ role: "system", content: system }, { role: "user", content: task }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `OpenAI ${r.status}`);
    return j.choices?.[0]?.message?.content || "";
  }
  if (model === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY مش متضاف");
    const m = process.env.GEMINI_MODEL || "gemini-2.5-pro";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: "POST", signal: T(180000),
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: task }] }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `Gemini ${r.status}`);
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  }
  throw new Error("المستشار لازم يكون gpt أو gemini");
}
