// Media on the 0G Router: image generation (z-image-turbo, priced per image)
// and speech-to-text (whisper-large-v3, priced per second). Same OpenAI-
// compatible endpoints and 0G API key. Each call also returns its cost.
import { createReadStream } from "node:fs";
import { CONFIG } from "./config.mjs";

async function pricingOf(client, modelId) {
  try {
    const res = await client.models.list();
    return (res.data || []).find((m) => m.id === modelId)?.pricing_usd || null;
  } catch {
    return null;
  }
}

// Generate images. Returns { images: base64 PNG[], cost }. n clamped to 1..2.
export async function generateImage(client, { prompt, n = 1 }) {
  const count = Math.max(1, Math.min(2, Number(n) || 1));
  const res = await client.images.generate({ model: CONFIG.imageModel, prompt, n: count });
  const images = (res?.data || []).map((d) => d.b64_json).filter(Boolean);
  if (!images.length) throw new Error("no image data returned (expected base64)");
  const pu = await pricingOf(client, CONFIG.imageModel);
  const per = Number(pu?.image ?? pu?.prompt ?? 0);
  const cost = per > 0 ? per * images.length : null;
  return { images, cost };
}

// Transcribe an audio file. Returns { text, duration, cost }.
export async function transcribeAudio(client, filePath) {
  let res;
  try {
    res = await client.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: CONFIG.transcribeModel,
      response_format: "verbose_json",
    });
  } catch {
    res = await client.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: CONFIG.transcribeModel,
    });
  }
  const text = (typeof res === "string" ? res : res?.text ?? "").trim();
  const duration = Number(res?.duration) || null;
  let cost = null;
  if (duration) {
    const pu = await pricingOf(client, CONFIG.transcribeModel);
    const per = Number(pu?.prompt ?? 0);
    if (per > 0) cost = per * duration;
  }
  return { text, duration, cost };
}
