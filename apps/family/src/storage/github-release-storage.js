const API = "https://api.github.com";
const ASSET_PREFIX = "family-vault-backup-";
const DEFAULT_TAG = "family-vault-cloud-backup";
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

async function sha256Hex(blob) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export class GitHubReleaseStorage {
  constructor({ owner, repo, tagName = DEFAULT_TAG, fetchImpl = globalThis.fetch } = {}) {
    if (!owner || !repo) throw new Error("GitHub 倉庫資訊不完整。");
    this.owner = owner;
    this.repo = repo;
    this.tagName = tagName;
    this.fetchImpl = fetchImpl;
    this.token = null;
  }

  setToken(token) {
    const value = String(token || "").trim();
    if (!/^github_pat_[A-Za-z0-9_]+$/.test(value)) {
      throw new Error("請使用 GitHub Fine-grained Personal Access Token（github_pat_ 開頭）。");
    }
    this.token = value;
  }

  clearToken() { this.token = null; }
  get connected() { return Boolean(this.token); }

  headers(extra = {}) {
    if (!this.token) throw new Error("請先連接 GitHub 私人倉庫。");
    return {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + this.token,
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra
    };
  }

  async api(path, options = {}) {
    const response = await this.fetchImpl(API + path, {
      ...options,
      headers: this.headers(options.headers || {})
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).message || ""; } catch {}
      const error = new Error("GitHub API " + response.status + (detail ? "：" + detail : ""));
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response.json();
  }

  basePath() { return "/repos/" + encodeURIComponent(this.owner) + "/" + encodeURIComponent(this.repo); }

  async getRelease() {
    try {
      return await this.api(this.basePath() + "/releases/tags/" + encodeURIComponent(this.tagName));
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async connect() {
    const repository = await this.api(this.basePath());
    if (!repository.private) throw new Error("指定的 GitHub 倉庫不是私人倉庫，為避免家庭資料外洩已停止連接。");
    this.branch = repository.default_branch || "main";
    return { repository: repository.full_name, private: repository.private, defaultBranch: this.branch, hasBackup: false };
  }

  async ensureRelease() {
    const existing = await this.getRelease();
    if (existing) return existing;
    try {
      return await this.api(this.basePath() + "/releases", {
        method: "POST",
        headers: { "Content-Type": "application/vnd.github+json" },
        body: JSON.stringify({
          tag_name: this.tagName,
          target_commitish: "main",
          name: "家庭資料庫加密雲端備份",
          body: "此 Release 僅保存用戶端加密後的家庭資料備份。請勿手動上傳明文資料。",
          draft: false,
          prerelease: true
        })
      });
    } catch (error) {
      if (error.status === 422) {
        const raced = await this.getRelease();
        if (raced) return raced;
      }
      throw error;
    }
  }

  async listAssets(releaseId) {
    return this.api(this.basePath() + "/releases/" + releaseId + "/assets?per_page=100");
  }

  async uploadBackup(blob) {
    if (!(blob instanceof Blob)) throw new Error("備份內容格式不正確。");
    if (blob.size === 0 || blob.size > MAX_ASSET_BYTES) throw new Error("備份檔案大小不符合 GitHub Release 限制。");
    const release = await this.ensureRelease();
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const name = ASSET_PREFIX + stamp + "-" + crypto.randomUUID().slice(0, 8) + ".familyvault";
    const uploadUrl = release.upload_url.replace(/\{\?name,label\}$/, "");
    const url = new URL(uploadUrl);
    url.searchParams.set("name", name);
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/octet-stream" }),
      body: blob
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).message || ""; } catch {}
      throw new Error("GitHub 備份上傳失敗（" + response.status + "）" + (detail ? "：" + detail : ""));
    }
    const uploaded = await response.json();
    if (uploaded.state !== "uploaded" || uploaded.size !== blob.size) {
      throw new Error("GitHub 回報的備份狀態或檔案大小不符，舊備份未刪除。");
    }
    if (uploaded.digest && uploaded.digest !== "sha256:" + await sha256Hex(blob)) {
      throw new Error("GitHub 回報的備份雜湊不符，舊備份未刪除。");
    }

    const assets = await this.listAssets(release.id);
    const byId = new Map(assets.map(asset => [asset.id, asset]));
    byId.set(uploaded.id, uploaded);
    const backups = [...byId.values()].filter(asset => asset.name.startsWith(ASSET_PREFIX))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const obsolete = backups.filter(asset => asset.id !== uploaded.id).slice(1);
    const cleanupErrors = [];
    let deletedCount = 0;
    for (const asset of obsolete) {
      try {
        await this.api(this.basePath() + "/releases/assets/" + asset.id, { method: "DELETE" });
        deletedCount++;
      } catch (error) { cleanupErrors.push(asset.name + "：" + error.message); }
    }
    return {
      name: uploaded.name,
      size: uploaded.size,
      createdAt: uploaded.created_at,
      retained: backups.length - deletedCount,
      cleanupErrors
    };
  }

  async downloadLatest() {
    const release = await this.getRelease();
    if (!release) throw new Error("GitHub 上尚未找到家庭資料備份。");
    const assets = await this.listAssets(release.id);
    const asset = assets.filter(item => item.name.startsWith(ASSET_PREFIX) && item.state === "uploaded")
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    if (!asset) throw new Error("備份 Release 中沒有可下載的資料檔。");
    const response = await this.fetchImpl(asset.url, {
      headers: this.headers({ Accept: "application/octet-stream" })
    });
    if (!response.ok) throw new Error("下載 GitHub 備份失敗（" + response.status + "）。");
    const blob = await response.blob();
    if (blob.size !== asset.size) throw new Error("下載檔案大小與 GitHub 記錄不一致，已拒絕還原。");
    if (asset.digest && asset.digest !== "sha256:" + await sha256Hex(blob)) {
      throw new Error("下載檔案 SHA-256 與 GitHub 記錄不一致，已拒絕還原。");
    }
    return { blob, name: asset.name, size: asset.size, createdAt: asset.created_at };
  }
}
