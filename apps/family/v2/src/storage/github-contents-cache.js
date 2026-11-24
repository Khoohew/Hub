const ROOT = "family-vault/v2";
const META = ROOT + "/meta";
const OBJECTS = ROOT + "/objects";

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function decodeBase64(value) {
  const binary = atob(String(value || "").replace(/\\s/g, ""));
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
    ? { __familyVaultBinary: bytesToBase64(item) }
    : item);
}
function deserialize(value) {
  return JSON.parse(value, (_, item) => {
    if (item && typeof item === "object" && typeof item.__familyVaultBinary === "string") {
      const binary = atob(item.__familyVaultBinary);
      return Uint8Array.from(binary, char => char.charCodeAt(0));
    }
    return item;
  });
}
function safePart(value) {
  return encodeURIComponent(String(value)).replace(/%/g, "~");
}

export class GitHubContentsCache {
  constructor(github) {
    if (!github?.connected) throw new Error("GitHub 尚未授權。");
    this.github = github;
  }
  pathFor(scope, collection, id) {
    return OBJECTS + "/" + safePart(scope) + "/" + safePart(collection) + "/" + safePart(id) + ".json";
  }
  metaPath(key) { return META + "/" + safePart(key) + ".json"; }
  async read(path) {
    try {
      const result = await this.github.api(this.github.basePath() + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(this.github.branch || "main") + "");
      if (result.type !== "file") throw new Error("GitHub 回傳的資料檔格式不正確。");
      let raw = result.content;
      if (!raw) {
        const rawUrl = this.github.basePath() + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
        const response = await this.github.fetchImpl("https://api.github.com" + rawUrl, {
          headers: this.github.headers({ Accept: "application/vnd.github.raw+json" })
        });
        if (!response.ok) throw new Error("讀取 GitHub 原始資料失敗（" + response.status + "）。");
        return { value: deserialize(await response.text()), sha: result.sha };
      }
      return { value: deserialize(decodeBase64(raw)), sha: result.sha };
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
  async write(path, value, sha = null) {
    const body = { message: "Update encrypted family vault data", content: encodeBase64(serialize(value)), branch: this.github.branch || "main" };
    if (sha) body.sha = sha;
    const result = await this.github.api(this.github.basePath() + "/contents/" + path.split("/").map(encodeURIComponent).join("/"), {
      method: "PUT",
      headers: { "Content-Type": "application/vnd.github+json" },
      body: JSON.stringify(body)
    });
    return result;
  }
  async get(objectId) {
    const parts = String(objectId).split(":");
    if (parts.length !== 3) throw new Error("資料識別碼格式錯誤。");
    const [scope, collection, id] = parts;
    const file = await this.read(this.pathFor(scope, collection, id));
    if (!file) return null;
    const row = file.value;
    return { objectId, collection, envelope: row.envelope, version: row.version, updatedAt: row.updatedAt, sha: file.sha };
  }
  async put(objectId, collection, envelope, expectedVersion = null) {
    const current = await this.get(objectId);
    if (expectedVersion === "absent" && current) throw new Error("REMOTE_VERSION_CONFLICT");
    if (expectedVersion !== null && expectedVersion !== "absent" && (current?.version ?? null) !== expectedVersion) throw new Error("REMOTE_VERSION_CONFLICT");
    const next = { formatVersion: 1, objectId, collection, envelope, version: (current?.version || 0) + 1, updatedAt: new Date().toISOString() };
    const result = await this.write(this.pathFor(...objectId.split(":")), next, current?.sha || null);
    return { version: next.version, sha: result.content?.sha || null };
  }
  async delete(objectId, expectedVersion = null) {
    const current = await this.get(objectId);
    if (!current) return { deleted: false };
    if (expectedVersion !== null && current.version !== expectedVersion) throw new Error("REMOTE_VERSION_CONFLICT");
    const path = this.pathFor(...objectId.split(":"));
    await this.github.api(this.github.basePath() + "/contents/" + path.split("/").map(encodeURIComponent).join("/"), {
      method: "DELETE",
      headers: { "Content-Type": "application/vnd.github+json" },
      body: JSON.stringify({ message: "Delete encrypted family vault data", sha: current.sha, branch: this.github.branch || "main" })
    });
    return { deleted: true };
  }
  async list(collection = null) {
    const scopes = collection ? ["family", "medical"] : ["family", "medical"];
    const output = [];
    for (const scope of scopes) {
      const collections = collection ? [collection] : ["persons", "relationships", "events", "media", "media-blobs", "health", "sources"];
      for (const kind of collections) {
        const path = OBJECTS + "/" + safePart(scope) + "/" + safePart(kind);
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
          const id = decodeURIComponent(entry.name.slice(0, -5).replace(/~/g, "%"));
          const objectId = scope + ":" + kind + ":" + id;
          const file = await this.read(path + "/" + entry.name);
          if (file) output.push({ objectId, collection: kind, version: file.value.version, updatedAt: file.value.updatedAt });
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
    await this.write(path, { key, value, updatedAt: new Date().toISOString() }, current?.sha || null);
  }
  close() {}
}