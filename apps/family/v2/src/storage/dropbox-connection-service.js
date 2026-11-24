import { DropboxOAuthClient } from "./dropbox-oauth.js";
import { DropboxStorageAdapter } from "./dropbox-storage-adapter.js";
import { syncDropboxVault } from "./dropbox-sync.js";
import { DROPBOX_APP_KEY, DROPBOX_APP_FOLDER_ROOT } from "./dropbox-config.js";

/**
 * Dropbox SPA session. The short-lived access token stays in memory only.
 * No refresh token or access token is written to IndexedDB, localStorage,
 * sessionStorage, backup files, or the repository.
 */
export class DropboxConnectionService {
  constructor({vault,appKey=DROPBOX_APP_KEY,redirectUri=new URL("./",location.href).href,fetchImpl=fetch,storage=sessionStorage}={}) {
    if(!vault)throw new Error("Dropbox connection requires a VaultService.");
    this.vault=vault;
    this.oauth=new DropboxOAuthClient({appKey,redirectUri,storage,fetchImpl});
    this.accessToken=null;
    this.expiresAt=0;
    this.accountId=null;
    this.adapter=new DropboxStorageAdapter({
      root:DROPBOX_APP_FOLDER_ROOT,
      fetchImpl,
      tokenProvider:()=>this.getAccessToken()
    });
  }

  beginAuthorization() { return this.oauth.getAuthorizeUrl(); }

  async completeAuthorization(search=location.search) {
    const tokens=await this.oauth.completeAuthorization(search);
    this.accessToken=tokens.accessToken;
    this.expiresAt=tokens.expiresAt;
    this.accountId=tokens.accountId;
    return {accountId:this.accountId,scope:tokens.scope};
  }

  async getAccessToken() {
    if(!this.accessToken||this.expiresAt<=Date.now()+30_000) {
      this.clearSession();
      throw new Error("Dropbox 短效授權已過期，請重新連接 Dropbox。");
    }
    return this.accessToken;
  }

  async sync(scope="family") {
    await this.getAccessToken();
    return syncDropboxVault(this.vault.cache,this.adapter,scope);
  }

  clearSession() {
    this.accessToken=null;
    this.expiresAt=0;
    this.accountId=null;
  }
}
