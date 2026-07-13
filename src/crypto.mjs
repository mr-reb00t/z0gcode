// Client-side encryption for session bundles before they go to 0G Storage.
// 0G Storage is public, so we encrypt with a key derived from the user's wallet
// private key: the content root can be public (anchored on-chain, in the INFT)
// while only that wallet can decrypt. AES-256-GCM (authenticated), no deps.
import crypto from "node:crypto";

const INFO = Buffer.from("z0gcode-session-v1");

function deriveKey(privKeyHex, salt) {
  const pk = Buffer.from(String(privKeyHex).replace(/^0x/, ""), "hex");
  return Buffer.from(crypto.hkdfSync("sha256", pk, salt, INFO, 32));
}

// Encrypt a Buffer, returning a self-describing JSON envelope Buffer.
export function encryptEnvelope(plaintext, privKeyHex) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(privKeyHex, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(JSON.stringify({
    tool: "z0gcode", enc: "AES-256-GCM", kdf: "hkdf-sha256(wallet)", v: 1,
    salt: salt.toString("base64"), iv: iv.toString("base64"),
    tag: tag.toString("base64"), ct: ct.toString("base64"),
  }));
}

// Decrypt an envelope Buffer with the wallet key. Throws if the key is wrong
// (a different wallet) or the data was tampered with.
export function decryptEnvelope(envelopeBuf, privKeyHex) {
  let e;
  try { e = JSON.parse(envelopeBuf.toString("utf8")); } catch { throw new Error("not an encrypted z0gcode bundle"); }
  if (!e || e.enc !== "AES-256-GCM" || !e.salt || !e.iv || !e.tag || !e.ct) throw new Error("not an encrypted z0gcode bundle");
  const key = deriveKey(privKeyHex, Buffer.from(e.salt, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
  decipher.setAuthTag(Buffer.from(e.tag, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(e.ct, "base64")), decipher.final()]);
  } catch {
    throw new Error("decryption failed: this session was encrypted for a different wallet");
  }
}

export function isEncryptedEnvelope(buf) {
  try { const e = JSON.parse(buf.toString("utf8")); return e && e.enc === "AES-256-GCM"; } catch { return false; }
}
