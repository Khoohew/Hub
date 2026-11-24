import { createVaultKey, unlockVaultKey, encryptJson, decryptJson, encryptBytes, decryptBytes, encryptBytesWithPassword, decryptBytesWithPassword } from "./crypto.js";
import { createId, nowIso } from "./id.js";

const SCOPE_KEYS = { family: "vault:family:descriptor", medical: "vault:medical:descriptor" };

export class VaultService {
  constructor(cache = null) {
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
    const objectId = scope + ":" + collection + ":" + recordId;
    const result = await this.cache.put(objectId, collection, value, expectedVersion);
    return { ...result, objectId, encrypted: false };
  }

  async load(scope, collection, recordId) {
    const key = this.keys.get(scope);
    const descriptor = this.descriptors.get(scope);
    const objectId = scope + ":" + collection + ":" + recordId;
    const stored = await this.cache.get(objectId);
    if (!stored) return null;
    if (Object.prototype.hasOwnProperty.call(stored, "value")) return { value: stored.value, version: stored.version, encrypted: false };
    if (!key || !descriptor) throw new Error("此紀錄仍是舊版加密資料；請使用舊保險庫密碼解鎖後遷移。");
    const context = { vaultId: descriptor.vaultId, collection, recordId, schemaVersion: stored.envelope.schemaVersion };
    return { value: await decryptJson(key, stored.envelope, context), version: stored.version, encrypted: true };
  }


  async saveBytes(scope, collection, recordId, schemaVersion, bytes, expectedVersion = null) {
    const objectId = scope + ":" + collection + ":" + recordId;
    const result = await this.cache.put(objectId, collection, { bytes: new Uint8Array(bytes) }, expectedVersion);
    return { ...result, objectId, encrypted: false };
  }

  async saveEncryptedBytes(scope, collection, recordId, schemaVersion, bytes, passphrase, expectedVersion = null) {
    const context = { collection, recordId, schemaVersion };
    const envelope = await encryptBytesWithPassword(passphrase, context, bytes);
    const objectId = scope + ":" + collection + ":" + recordId;
    const result = await this.cache.put(objectId, collection, envelope, expectedVersion);
    return { ...result, objectId, encrypted: true };
  }

  async loadBytes(scope, collection, recordId, passphrase = null) {
    const objectId = scope + ":" + collection + ":" + recordId;
    const stored = await this.cache.get(objectId);
    if (!stored) return null;
    if (Object.prototype.hasOwnProperty.call(stored, "value")) {
      const bytes = stored.value?.bytes;
      if (!(bytes instanceof Uint8Array)) throw new Error("明文附件格式不正確。");
      return { bytes, version: stored.version, encrypted: false };
    }
    if (stored.envelope?.algorithm === "AES-256-GCM-PBKDF2") {
      if (!passphrase) throw new Error("此附件已加密，需要輸入該附件的密碼。");
      const context = { collection, recordId, schemaVersion: stored.envelope.schemaVersion };
      return { bytes: await decryptBytesWithPassword(passphrase, stored.envelope, context), version: stored.version, encrypted: true };
    }
    const key = this.keys.get(scope), descriptor = this.descriptors.get(scope);
    if (!key || !descriptor) throw new Error("此附件仍是舊版整庫加密資料，無法用新附件密碼方式讀取。");
    const context = { vaultId: descriptor.vaultId, collection, recordId, schemaVersion: stored.envelope.schemaVersion };
    return { bytes: await decryptBytes(key, stored.envelope, context), version: stored.version, encrypted: true };
  }

  async sealBackupManifest(manifest) {
    const key=this.keys.get("family");
    const descriptor=this.descriptors.get("family");
    if(!key||!descriptor)throw new Error("請先解鎖家庭保險庫，再認證備份清單。");
    const context={vaultId:descriptor.vaultId,collection:"backup-manifest",recordId:"manifest",schemaVersion:1};
    return encryptJson(key,context,manifest);
  }

  async delete(scope, collection, recordId, expectedVersion = null) {
    return this.cache.delete(scope + ":" + collection + ":" + recordId, expectedVersion);
  }

  newRecordId(kind) { return createId(kind); }
  close() { this.lock(); this.cache.close(); }
}
