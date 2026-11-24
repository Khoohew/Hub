const DB_NAME = "family-vault-cache-v2";
const DB_VERSION = 2;
const STORE = "encryptedObjects";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

export class EncryptedLocalCache {
  constructor() { this.db = null; }

  async open() {
    if (this.db) return;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "objectId" });
          store.createIndex("collection", "collection", { unique: false });
        }
        if (!db.objectStoreNames.contains("vaultMeta")) db.createObjectStore("vaultMeta", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Cannot open encrypted cache."));
      request.onblocked = () => reject(new Error("Encrypted cache upgrade is blocked by another tab."));
    });
    this.db.onversionchange = () => { this.db.close(); this.db = null; };
  }

  async get(objectId) {
    await this.open();
    const tx = this.db.transaction(STORE, "readonly");
    const done = transactionDone(tx);
    const value = await requestResult(tx.objectStore(STORE).get(objectId));
    await done;
    return value || null;
  }

  async put(objectId, collection, encryptedEnvelope, expectedVersion = null) {
    await this.open();
    const tx = this.db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    const current = await requestResult(store.get(objectId));
    if (expectedVersion === "absent" && current) {
      tx.abort();
      await done.catch(() => {});
      throw new Error("LOCAL_VERSION_CONFLICT");
    }
    if (expectedVersion !== null && expectedVersion !== "absent" && (current?.version ?? null) !== expectedVersion) {
      tx.abort();
      await done.catch(() => {});
      throw new Error("LOCAL_VERSION_CONFLICT");
    }
    const next = {
      objectId,
      collection,
      envelope: encryptedEnvelope,
      version: (current?.version || 0) + 1,
      updatedAt: new Date().toISOString()
    };
    store.put(next);
    await done;
    return { version: next.version };
  }

  async delete(objectId, expectedVersion = null) {
    await this.open();
    const tx = this.db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    const current = await requestResult(store.get(objectId));
    if (!current) { await done; return { deleted: false }; }
    if (expectedVersion !== null && current.version !== expectedVersion) {
      tx.abort();
      await done.catch(() => {});
      throw new Error("LOCAL_VERSION_CONFLICT");
    }
    store.delete(objectId);
    await done;
    return { deleted: true };
  }

  async list(collection = null) {
    await this.open();
    const tx = this.db.transaction(STORE, "readonly");
    const done = transactionDone(tx);
    const values = collection
      ? await requestResult(tx.objectStore(STORE).index("collection").getAll(collection))
      : await requestResult(tx.objectStore(STORE).getAll());
    await done;
    return values.map(({ objectId, collection: kind, version, updatedAt }) => ({
      objectId, collection: kind, version, updatedAt
    }));
  }

  async getMeta(key) {
    await this.open();
    const tx = this.db.transaction("vaultMeta", "readonly");
    const done = transactionDone(tx);
    const value = await requestResult(tx.objectStore("vaultMeta").get(key));
    await done;
    return value?.value ?? null;
  }

  async setMeta(key, value) {
    await this.open();
    const tx = this.db.transaction("vaultMeta", "readwrite");
    const done = transactionDone(tx);
    tx.objectStore("vaultMeta").put({ key, value });
    await done;
  }

  close() { if (this.db) this.db.close(); this.db = null; }
}
