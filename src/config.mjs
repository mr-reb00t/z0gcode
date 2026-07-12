// z0gcode configuration. 0G is baked in as the default backend.
// Everything can be overridden by env vars, but nothing needs to be.

function envList(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export const CONFIG = {
  // 0G Compute Router (OpenAI-compatible). Mainnet by default.
  baseURL: process.env.ZOG_BASE_URL || "https://router-api.0g.ai/v1",
  apiKey: process.env.ZOG_API_KEY || "",

  // Default model: 0G's own in-house coding model (private + verifiable, TEE).
  model: process.env.ZOG_MODEL || "0gm-1.0-35b-a3b",
  // App-level fallbacks: the Router does NOT switch models on 503, so we do.
  fallbacks: envList("ZOG_FALLBACKS", ["deepseek-v4-pro", "glm-5.2", "kimi-k2.7-code"]),

  maxSteps: Number(process.env.ZOG_MAX_STEPS || 30),
  maxTokens: Number(process.env.ZOG_MAX_TOKENS || 16384),
  temperature: Number(process.env.ZOG_TEMPERATURE || 0.2),
};

export function modelChain(preferred) {
  const primary = preferred || CONFIG.model;
  const chain = [primary, ...CONFIG.fallbacks.filter((m) => m !== primary)];
  return chain;
}
