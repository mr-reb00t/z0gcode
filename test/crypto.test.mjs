import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptEnvelope, decryptEnvelope, isEncryptedEnvelope } from "../src/crypto.mjs";

const KA = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const KB = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const plain = Buffer.from(JSON.stringify({ session: { title: "secret", messages: ["private stuff"] } }));

test("round-trips with the same wallet key", () => {
  const env = encryptEnvelope(plain, KA);
  assert.equal(isEncryptedEnvelope(env), true);
  assert.deepEqual(decryptEnvelope(env, KA), plain);
});

test("ciphertext does not leak the plaintext", () => {
  const env = encryptEnvelope(plain, KA).toString();
  assert.ok(!env.includes("private stuff"));
  assert.ok(!env.includes("secret"));
});

test("a different wallet cannot decrypt", () => {
  const env = encryptEnvelope(plain, KA);
  assert.throws(() => decryptEnvelope(env, KB), /different wallet/);
});

test("each encryption uses a fresh salt/iv (ciphertext differs)", () => {
  assert.notEqual(encryptEnvelope(plain, KA).toString(), encryptEnvelope(plain, KA).toString());
});

test("isEncryptedEnvelope is false for plaintext", () => {
  assert.equal(isEncryptedEnvelope(plain), false);
});
