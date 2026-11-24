const ROOT = "data/family/v1/objects";
const LEGACY_ROOT = "family-vault/v2/objects";
const LEGACY_META = "family-vault/v2/meta";

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function decodeBase64(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function serialize(value) {
  return JSON.stringify(value, (_, item) => item instanceof Uint8Array
    ? { __familyDataBinary: bytesToBase64(item) }
    : item);
}
function deserialize(value) {
  return JSON.parse(value, (_, item) => {
    if (item && typeof item === "object" && typeof item.__familyDataBinary === "string") {
      const binary = atob(item.__familyDataBinary);
      return Uint8Array.from(binary, char => char.charCodeAt(0));
    }
    return item;
  });
}
function safePart(value) {
  return encodeURIComponent(String(value)).replace(/%/g, "~");
}
function decodePart(value) {
  return decodeURIComponent(String(value).replace(/~/g, "%"));
}

/**
 * Plaintext-first GitHub store. New records are ordinary JSON in a private
 * repository. Legacy encrypted envelopes remain readable through the old
 * v2 path so migration can be explicit and non-destructive.
 */
export class GitHubPlainContentsCache {
  constructor(github) {
    if (!github?.connected) throw new Error("GitHub 尚未授權。");
    this.github = github;
  }
  pathFor(scope, collection, id) {
    return ROOT + "/" + safePart(scope) + "/" + safePart(collection) + "/" + safePart(id) + ".json";
  }
  legacyPathFor(scope, collection, id) {
    return LEGACY_ROOT + "/" + safePart(scope) + "/" + safePart(collection) + "/" + safePart(id) + ".json";
  }
  metaPath(key) { return LEGACY_META + "/" + safePart(key) + ".json"; }
  async read(path) {
    try {
      const url = this.github.basePath() + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(this.github.branch || "main");
      const result = await this.github.api(url);
      if (result.type !== "file") throw new Error("GitHub 回傳的資料檔格式不正確。");
      if (!result.content) {
        const rawUrl = this.github.basePath() + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
        const response = await this.github.fetchImpl("https://api.github.com" + rawUrl, {
          headers: this.github.headers({ Accept: "application/vnd.github.raw+json" })
        });
        if (!response.ok) throw new Error("讀取 GitHub 資料失敗（" + response.status + "）。");
        return { value: deserialize(await response.text()), sha: result.sha };
      }
      return { value: deserialize(decodeBase64(result.content)), sha: result.sha };
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
  async write(path, value, sha = null, message = "Update family data") {
    const body = { message, content: encodeBase64(serialize(value)), branch: this.github.branch || "main" };
    if (sha) body.sha = sha;
    return this.github.api(this.github.basePath() + "/contents/" + path.split("/").map(encodeURIComponent).join("/"), {
      method: "PUT",
      headers: { "Content-Type": "application/vnd.github+json" },
      body: JSON.stringify(body)
    });
  }
  async get(objectId) {
    const parts = String(objectId).split(":");
    if (parts.length !== 3) throw new Error("資料識別碼格式錯誤。");
    const [scope, collection, id] = parts;
    const current = await this.read(this.pathFor(scope, collection, id));
    if (current) { const stored = current.value.value; const encrypted = (stored?.algorithm === "AES-256-GCM" || stored?.algorithm === "AES-256-GCM-PBKDF2") && stored?.ciphertext; return encrypted ? { objectId, collection, envelope: stored, version: current.value.version, updatedAt: current.value.updatedAt, sha: current.sha, legacyEncrypted: true } : { objectId, collection, value: stored, version: current.value.version, updatedAt: current.value.updatedAt, sha: current.sha, plaintext: true }; }
    const legacy = await this.read(this.legacyPathFor(scope, collection, id));
    if (!legacy) return null;
    const row = legacy.value;
    return { objectId, collection, envelope: row.envelope, version: row.version, updatedAt: row.updatedAt, sha: legacy.sha, legacyEncrypted: true };
  }
  async put(objectId, collection, value, expectedVersion = null) {
    const parts = String(objectId).split(":");
    if (parts.length !== 3) throw new Error("資料識別碼格式錯誤。");
    const [scope, kind, id] = parts;
    const current = await this.read(this.pathFor(scope, kind, id));
    const legacy = current ? null : await this.read(this.legacyPathFor(scope, kind, id));
    const currentVersion = current?.value?.version ?? legacy?.value?.version ?? null;
    if (expectedVersion === "absent" && (current || legacy)) throw new Error("REMOTE_VERSION_CONFLICT");
    if (expectedVersion !== null && expectedVersion !== "absent" && currentVersion !== expectedVersion) throw new Error("REMOTE_VERSION_CONFLICT");
    const next = { formatVersion: 1, objectId, collection, value, version: (currentVersion || 0) + 1, updatedAt: new Date().toISOString() };
    const result = await this.write(this.pathFor(scope, kind, id), next, current?.sha || null);
    return { version: next.version, sha: result.content?.sha || null };
  }
  async delete(objectId, expectedVersion = null) {
    const parts = String(objectId).split(":");
    if (parts.length !== 3) throw new Error("資料識別碼格式錯誤。");
    const [scope, collection, id] = parts;
    const paths = [this.pathFor(scope, collection, id), this.legacyPathFor(scope, collection, id)];
    let deleted = false;
    for (const path of paths) {
      const current = await this.read(path);
      if (!current) continue;
      const version = current.value.version;
      if (expectedVersion !== null && version !== expectedVersion) throw new Error("REMOTE_VERSION_CONFLICT");
      await this.github.api(this.github.basePath() + "/contents/" + path.split("/").map(encodeURIComponent).join("/"), {
        method: "DELETE",
        headers: { "Content-Type": "application/vnd.github+json" },
        body: JSON.stringify({ message: "Delete family data", sha: current.sha, branch: this.github.branch || "main" })
      });
      deleted = true;
    }
    return { deleted };
  }
  async list(collection = null) {
    const output = [];
    const scopes = ["family", "medical"];
    const kinds = collection ? [collection] : ["persons", "relationships", "events", "media", "media-blobs", "health", "sources"];
    for (const scope of scopes) for (const kind of kinds) {
      for (const root of [ROOT, LEGACY_ROOT]) {
        const path = root + "/" + safePart(scope) + "/" + safePart(kind);
        let entries;
        try {
          entries = await this.github.api(this.github.basePath() + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(this.github.branch || "main"));
        } catch (error) {
          if (error.status === 404) continue;
          throw error;
        }
        if (!Array.isArray(entries)) continue;
        if (entries.length >= 1000) throw new Error("此資料分類已達 GitHub 單一目錄 1,000 個項目的上限，請先分批整理附件。");
        for (const entry of entries) {
          if (entry.type !== "file" || !entry.name.endsWith(".json")) continue;
          const id = decodePart(entry.name.slice(0, -5));
          const objectId = scope + ":" + kind + ":" + id;
          if (output.some(item => item.objectId === objectId)) continue;
          const file = await this.get(objectId);
          if (file) output.push({ objectId, collection: kind, version: file.version, updatedAt: file.updatedAt, plaintext: !!file.plaintext, legacyEncrypted: !!file.legacyEncrypted });
        }
      }
    }
    return output;
  }
  async getMeta(key) {
    const file = await this.read(this.metaPath(key));
    return file?.value?.value ?? null;
  }
  async setMeta(key, value) {
    const path = this.metaPath(key);
    const current = await this.read(path);
    await this.write(path, { key, value, updatedAt: new Date().toISOString() }, current?.sha || null, "Update legacy vault metadata");
  }
  close() {}
}
