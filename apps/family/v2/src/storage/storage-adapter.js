/**
 * Provider-neutral encrypted object storage contract.
 * Implementations must store ciphertext only and must never persist access tokens
 * in localStorage, sessionStorage, URLs, source files, or repository content.
 */
export class StorageAdapter {
  async get(_objectId) { throw new Error("StorageAdapter.get is not implemented."); }
  async put(_objectId, _bytes, _expectedVersion = null) { throw new Error("StorageAdapter.put is not implemented."); }
  async delete(_objectId, _expectedVersion = null) { throw new Error("StorageAdapter.delete is not implemented."); }
  async list(_prefix = "", _cursor = null) { throw new Error("StorageAdapter.list is not implemented."); }
}
export class StorageConflictError extends Error {
  constructor(message = "Cloud object changed since it was read.") {
    super(message);
    this.name = "StorageConflictError";
  }
}
export class StorageAuthorizationError extends Error {
  constructor(message = "Cloud authorization is missing or expired.") {
    super(message);
    this.name = "StorageAuthorizationError";
  }
}
