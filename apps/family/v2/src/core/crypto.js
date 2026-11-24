const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function randomBytes(size) {
  return crypto.getRandomValues(new Uint8Array(size));
}
function aadFor({ vaultId, collection, recordId, schemaVersion }) {
  return encoder.encode(JSON.stringify([vaultId, collection, recordId, schemaVersion]));
}
async function deriveWrappingKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(passphrase).normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Creates a random vault master key and wraps it with a password-derived key.
 * The returned CryptoKey is non-extractable and should remain in memory only.
 */
export async function createVaultKey(passphrase, { vaultId = crypto.randomUUID(), scope = "family" } = {}) {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new Error("請使用至少 12 個字元的高強度密碼。");
  }
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const rawMaster = randomBytes(KEY_BYTES);
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  const wrappedMasterKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode("family-vault-key-v1:" + scope) },
    wrappingKey,
    rawMaster
  );
  const masterKey = await crypto.subtle.importKey("raw", rawMaster, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  rawMaster.fill(0);
  return {
    key: masterKey,
    descriptor: {
      formatVersion: 1,
      vaultId,
      scope,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
      cipher: { name: "AES-256-GCM", iv: bytesToBase64(iv), wrappedMasterKey: bytesToBase64(new Uint8Array(wrappedMasterKey)) }
    }
  };
}

/** Unlocks a vault key descriptor. Failed passwords and tampering both reject. */
export async function unlockVaultKey(passphrase, descriptor) {
  if (!descriptor || descriptor.formatVersion !== 1) throw new Error("不支援的保險庫格式。");
  if (descriptor.kdf?.name !== "PBKDF2" || descriptor.cipher?.name !== "AES-256-GCM") {
    throw new Error("不支援的金鑰包裝演算法。");
  }
  if (!["family", "medical"].includes(descriptor.scope) || typeof descriptor.vaultId !== "string") {
    throw new Error("保險庫識別資訊不正確。");
  }
  const iterations = Number(descriptor.kdf.iterations);
  if (!Number.isInteger(iterations) || iterations < 300_000 || iterations > 2_000_000) {
    throw new Error("金鑰派生參數超出安全允許範圍。");
  }
  const salt = base64ToBytes(descriptor.kdf.salt);
  const iv = base64ToBytes(descriptor.cipher.iv);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) {
    throw new Error("金鑰包裝參數長度不正確。");
  }
  const wrappingKey = await deriveWrappingKey(passphrase, salt, iterations);
  const rawMaster = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode("family-vault-key-v1:" + descriptor.scope) },
    wrappingKey,
    base64ToBytes(descriptor.cipher.wrappedMasterKey)
  ));
  try {
    return await crypto.subtle.importKey("raw", rawMaster, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } finally {
    rawMaster.fill(0);
  }
}

/** Encrypts a JSON record. Every call generates a fresh IV. */
export async function encryptJson(key, context, value) {
  const iv = randomBytes(IV_BYTES);
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aadFor(context) },
    key,
    plaintext
  );
  return {
    formatVersion: 1,
    vaultId: context.vaultId,
    collection: context.collection,
    recordId: context.recordId,
    schemaVersion: context.schemaVersion,
    algorithm: "AES-256-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

/** Decrypts a JSON envelope only when its authenticated context matches. */
export async function decryptJson(key, envelope, expectedContext) {
  if (envelope?.formatVersion !== 1 || envelope?.algorithm !== "AES-256-GCM") {
    throw new Error("不支援的加密資料格式。");
  }
  const context = {
    vaultId: expectedContext.vaultId,
    collection: expectedContext.collection,
    recordId: expectedContext.recordId,
    schemaVersion: expectedContext.schemaVersion
  };
  if (
    envelope.vaultId !== context.vaultId ||
    envelope.collection !== context.collection ||
    envelope.recordId !== context.recordId ||
    envelope.schemaVersion !== context.schemaVersion
  ) throw new Error("資料識別資訊不一致，已停止解密。");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData: aadFor(context) },
    key,
    base64ToBytes(envelope.ciphertext)
  );
  return JSON.parse(decoder.decode(plaintext));
}

/** Encrypts binary media without converting the original file to a data URL. */
export async function encryptBytes(key, context, bytes) {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aadFor(context) },
    key,
    bytes
  );
  return {
    formatVersion: 1,
    vaultId: context.vaultId,
    collection: context.collection,
    recordId: context.recordId,
    schemaVersion: context.schemaVersion,
    algorithm: "AES-256-GCM",
    iv: bytesToBase64(iv),
    ciphertext: new Uint8Array(ciphertext)
  };
}

/** Decrypts binary media bytes. */
export async function decryptBytes(key, envelope, expectedContext) {
  if (envelope?.formatVersion !== 1 || envelope?.algorithm !== "AES-256-GCM") {
    throw new Error("不支援的加密附件格式。");
  }
  const context = {
    vaultId: expectedContext.vaultId,
    collection: expectedContext.collection,
    recordId: expectedContext.recordId,
    schemaVersion: expectedContext.schemaVersion
  };
  if (
    envelope.vaultId !== context.vaultId ||
    envelope.collection !== context.collection ||
    envelope.recordId !== context.recordId ||
    envelope.schemaVersion !== context.schemaVersion
  ) throw new Error("附件識別資訊不一致，已停止解密。");
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData: aadFor(context) },
    key,
    envelope.ciphertext instanceof Uint8Array ? envelope.ciphertext : base64ToBytes(envelope.ciphertext)
  ));
}
