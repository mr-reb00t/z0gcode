// Media on the 0G Router: image generation (z-image-turbo) and speech-to-text
// (whisper-large-v3), via the same OpenAI-compatible endpoints and 0G API key.
import { createReadStream } from "node:fs";
import { CONFIG } from "./config.mjs";

// Generate images. Returns an array of base64 PNG strings. n is clamped to 1..2
// (the model's per-request limit).
export async function generateImage(client, { prompt, n = 1 }) {
  const count = Math.max(1, Math.min(2, Number(n) || 1));
  const res = await client.images.generate({ model: CONFIG.imageModel, prompt, n: count });
  const images = (res?.data || []).map((d) => d.b64_json).filter(Boolean);
  if (!images.length) throw new Error("no image data returned (expected base64)");
  return images;
}

// Transcribe an audio file to text.
export async function transcribeAudio(client, filePath) {
  const res = await client.audio.transcriptions.create({
    file: createReadStream(filePath),
    model: CONFIG.transcribeModel,
  });
  return (typeof res === "string" ? res : res?.text ?? "").trim();
}
