import { createVaultKey, unlockVaultKey, encryptJson, decryptJson, encryptBytes, decryptBytes } from "./crypto.js";
import { EncryptedLocalCache } from "../storage/indexeddb-cache.js";
import { createId, nowIso } from "./id.js";

const SCOPE_KEYS = { family: "vault:family:descriptor", medical: "vault:medical:descriptor" };

export class VaultService {
  constructor(cache = new EncryptedLocalCache()) {
    this.cache = cache;
    this.keys = new Map();
    this.descriptors = new Map();
  }

  async status(scope = "family") {
    if (!SCOPE_KEYS[scope]) throw new Error("未知保險庫類型。");
    const descriptor = await this.cache.getMeta(SCOPE_KEYS[scope]);
    return { exists: !!descriptor, unlocked: this.keys.has(scope), scope };
  }

  async create(scope, passphrase) {
    if (!SCOPE_KEYS[scope]) throw new Error("未知保險庫類型。");
    if (await this.cache.getMeta(SCOPE_KEYS[scope])) throw new Error("此保險庫已建立，請使用解鎖功能。");
    const { key, descriptor } = await createVaultKey(passphrase, { scope });
    descriptor.createdAt = nowIso();
    await this.cache.setMeta(SCOPE_KEYS[scope], descriptor);
    this.keys.set(scope, key);
    this.descriptors.set(scope, descriptor);
    return { vaultId: descriptor.vaultId, scope };
  }

  async unlock(scope, passphrase) {
    if (!SCOPE_KEYS[scope]) throw new Error("未知保險庫類型。");
    const descriptor = await this.cache.getMeta(SCOPE_KEYS[scope]);
    if (!descriptor) throw new Error("尚未建立此保險庫。");
    const key = await unlockVaultKey(passphrase, descriptor);
    this.keys.set(scope, key);
    this.descriptors.set(scope, descriptor);
    return { vaultId: descriptor.vaultId, scope };
  }

  lock(scope) {
    if (scope) {
      this.keys.delete(scope);
      this.descriptors.delete(scope);
      return;
    }
    this.keys.clear();
    this.descriptors.clear();
  }

  async save(scope, collection, recordId, schemaVersion, value, expectedVersion = null) {
    const key = this.keys.get(scope);
    const descriptor = this.descriptors.get(scope);
    if (!key || !descriptor) throw new Error("請先解鎖對應保險庫。");
    const context = { vaultId: descriptor.vaultId, collection, recordId, schemaVersion };
    const envelope = await encryptJson(key, context, value);
    const objectId = scope + ":" + collection + ":" + recordId;
    const result = await this.cache.put(objectId, collection, envelope, expectedVersion);
    return { ...result, objectId };
  }

  async load(scope, collection, recordId) {
    const key = this.keys.get(scope);
    const descriptor = this.descriptors.get(scope);
    if (!key || !descriptor) throw new Error("請先解鎖對應保險庫。");
    const objectId = scope + ":" + collection + ":" + recordId;
    const stored = await this.cache.get(objectId);
    if (!stored) return null;
    const context = {
      vaultId: descriptor.vaultId,
      collection,
      recordId,
      schemaVersion: stored.envelope.schemaVersion
    };
    return { value: await decryptJson(key, stored.envelope, context), version: stored.version };
  }


  async saveBytes(scope, collection, recordId, schemaVersion, bytes, expectedVersion = null) {
    const key = this.keys.get(scope);
    const descriptor = this.descriptors.get(scope);
    if (!key || !descriptor) throw new Error("請先解鎖對應保險庫。");
    const context = { vaultId: descriptor.vaultId, collection, recordId, schemaVersion };
    const envelope = await encryptBytes(key, context, bytes);
    const objectId = scope + ":" + collection + ":" + recordId;
    const result = await this.cache.put(objectId, collection, envelope, expectedVersion);
    return { ...result, objectId };
  }

  async loadBytes(scope, collection, recordId) {
    const key = this.keys.get(scope);
    const descriptor = this.descriptors.get(scope);
    if (!key || !descriptor) throw new Error("請先解鎖對應保險庫。");
    const objectId = scope + ":" + collection + ":" + recordId;
    const stored = await this.cache.get(objectId);
    if (!stored) return null;
    const context = {
      vaultId: descriptor.vaultId,
      collection,
      recordId,
      schemaVersion: stored.envelope.schemaVersion
    };
    return { bytes: await decryptBytes(key, stored.envelope, context), version: stored.version };
  }

  async delete(scope, collection, recordId, expectedVersion = null) {
    if (!this.keys.has(scope)) throw new Error("請先解鎖對應保險庫。");
    return this.cache.delete(scope + ":" + collection + ":" + recordId, expectedVersion);
  }

  newRecordId(kind) { return createId(kind); }
  close() { this.lock(); this.cache.close(); }
}
