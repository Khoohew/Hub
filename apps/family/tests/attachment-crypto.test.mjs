import test from "node:test";
import assert from "node:assert/strict";
import { encryptBytesWithPassword, decryptBytesWithPassword } from "../src/core/crypto.js";

const context = { collection: "media-blobs", recordId: "M-test-001", schemaVersion: 1 };
const password = "correct horse battery staple 2026";

test("an encrypted attachment round-trips with its own password", async () => {
  const original = new Uint8Array([0, 1, 2, 3, 127, 128, 254, 255]);
  const envelope = await encryptBytesWithPassword(password, context, original);
  assert.equal(envelope.algorithm, "AES-256-GCM-PBKDF2");
  assert.notDeepEqual(envelope.ciphertext, original);
  const restored = await decryptBytesWithPassword(password, envelope, context);
  assert.deepEqual([...restored], [...original]);
});

test("an encrypted attachment rejects a wrong password", async () => {
  const original = new Uint8Array([10, 20, 30]);
  const envelope = await encryptBytesWithPassword(password, context, original);
  await assert.rejects(() => decryptBytesWithPassword("wrong password 2026", envelope, context));
});

test("an encrypted attachment rejects a mismatched record identity", async () => {
  const original = new Uint8Array([1, 2, 3]);
  const envelope = await encryptBytesWithPassword(password, context, original);
  await assert.rejects(() => decryptBytesWithPassword(password, envelope, { ...context, recordId: "M-other" }));
});
