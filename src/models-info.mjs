// Model catalog: fetch + normalize the 0G Router's GET /v1/models into the
// fields the CLI renders (price, context, capabilities, TEE, discount).
// All display data comes from the API; only the "vs official" discount is a
// bundled reference (the Router API does not expose it).

// "vs official API price" savings, from the 0G pricing page. Reference only:
// the live price column always comes from the API, so if these drift the
// numbers a user actually pays stay correct.
export const DISCOUNTS = {
  "minimax-m3": 55,
  "0gm-1.0-35b-a3b": 50,
  "qwen3.7-max": 60,
  "qwen3.6-plus": 50,
  "qwen3.7-plus": 45,
  "glm-5": 40,
  "glm-5.1": 35,
  "glm-5.2": 30,
  "kimi-k2.7-code": 18,
  "deepseek-v4-pro": 15,
  "deepseek-v4-flash": 12,
  "claude-fable-5": 10,
  "claude-opus-4-8": 10,
};

// Binary K, decimal M: 262144 -> "256K", 32768 -> "32K", 131072 -> "128K",
// 1000000 -> "1M", 1048576 -> "1.0M" (the values developers recognize).
export function fmtCtx(n) {
  if (!n || n <= 0) return "?";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return (Math.abs(v - 1) < 1e-9 ? "1" : v.toFixed(1)) + "M";
  }
  return Math.round(n / 1024) + "K";
}

// $/1M tokens, adaptive precision so tiny prices keep meaning.
export function fmtPrice(perM) {
  if (perM == null) return "-";
  if (perM >= 100) return "$" + perM.toFixed(0);
  if (perM >= 1) return "$" + perM.toFixed(2);
  return "$" + perM.toFixed(perM < 0.1 ? 4 : 3);
}

function normalize(m) {
  const im = m.architecture?.input_modalities || [];
  const sp = m.supported_parameters || [];
  const inUsd = Number(m.pricing_usd?.prompt);
  const outUsd = Number(m.pricing_usd?.completion);
  return {
    id: m.id,
    name: m.name || m.id,
    description: m.description || "",
    type: m.type || "chatbot",
    ctx: m.context_length || null,
    maxOut: m.max_completion_tokens || null,
    inPerM: Number.isFinite(inUsd) && inUsd > 0 ? inUsd * 1e6 : null,
    outPerM: Number.isFinite(outUsd) && outUsd > 0 ? outUsd * 1e6 : null,
    tools: sp.includes("tools"),
    vision: im.includes("image"),
    verifiable: !!m.tee_attested && !!m.verifiability && m.verifiability !== "None",
    private: m.verifiability === "TeeML",
    tee: m.tee_type || null,
    discount: DISCOUNTS[m.id] ?? null,
    raw: m,
  };
}

// Fetch and normalize. Returns [] on failure is NOT desired; let caller catch.
export async function fetchModels(client) {
  const res = await client.models.list();
  return (res.data || []).map(normalize);
}

// Chat/coding models, ordered: default first, then verifiable+tools by input
// price ascending, then the rest, then non-verifiable (e.g. proxied Claude).
export function orderChatModels(models, defaultId) {
  const chat = models.filter((m) => m.type === "chatbot");
  const rank = (m) => {
    if (m.id === defaultId) return 0;
    if (m.verifiable && m.tools) return 1;
    if (m.verifiable) return 2;
    return 3;
  };
  return chat.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const pa = a.inPerM ?? Infinity;
    const pb = b.inPerM ?? Infinity;
    return pa - pb;
  });
}

// Trust band for grouping: 0 = 0G native, 1 = verifiable/private (TEE), 2 = open.
export function bandRank(m) {
  if (String(m.id).startsWith("0gm")) return 0;
  if (m.private || m.verifiable) return 1;
  return 2;
}

// Chat models grouped by trust band, then by price, for the banded picker.
export function orderChatModelsBanded(models) {
  return models
    .filter((m) => m.type === "chatbot" && m.tools)
    .sort((a, b) => bandRank(a) - bandRank(b) || (a.inPerM ?? Infinity) - (b.inPerM ?? Infinity));
}

// Non-chat models (speech, image) for a separate compact section.
export function mediaModels(models) {
  return models.filter((m) => m.type !== "chatbot");
}
