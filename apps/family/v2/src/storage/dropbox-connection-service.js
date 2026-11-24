import { DropboxOAuthClient } from "./dropbox-oauth.js";
import { DropboxStorageAdapter } from "./dropbox-storage-adapter.js";
import { syncDropboxVault } from "./dropbox-sync.js";
import { DROPBOX_APP_KEY, DROPBOX_APP_FOLDER_ROOT } from "./dropbox-config.js";

const CONNECTION_ID="dropbox";
const CONNECTION_COLLECTION="connections";

export class DropboxConnectionService {
  constructor({vault,appKey=DROPBOX_APP_KEY,redirectUri=new URL("./",location.href).href,fetchImpl=fetch,storage=sessionStorage}={}) {
    if(!vault)throw new Error("Dropbox connection requires a VaultService.");
    this.vault=vault;
    this.oauth=new DropboxOAuthClient({appKey,redirectUri,storage,fetchImpl});
    this.fetchImpl=fetchImpl;
    this.refreshToken=null;
    this.connectionVersion=null;
    this.accessToken=null;
    this.expiresAt=0;
    this.adapter=new DropboxStorageAdapter({
      root:DROPBOX_APP_FOLDER_ROOT,
      fetchImpl,
      tokenProvider:()=>this.getAccessToken()
    });
  }

  beginAuthorization() { return this.oauth.getAuthorizeUrl(); }

  async completeAuthorization(search=location.search) {
    const tokens=await this.oauth.completeAuthorization(search);
    if(!tokens.refreshToken)throw new Error("Dropbox 沒有返回 Refresh Token，請確認授權網址包含 token_access_type=offline。");
    const current=await this.vault.load("family",CONNECTION_COLLECTION,CONNECTION_ID);
    const record={
      provider:"dropbox",
      refreshToken:tokens.refreshToken,
      accountId:tokens.accountId,
      scope:tokens.scope,
      updatedAt:new Date().toISOString()
    };
    const saved=await this.vault.save("family",CONNECTION_COLLECTION,CONNECTION_ID,1,record,current?.version??null);
    this.refreshToken=tokens.refreshToken;
    this.connectionVersion=saved.version;
    this.accessToken=tokens.accessToken;
    this.expiresAt=tokens.expiresAt;
    return {accountId:tokens.accountId,scope:tokens.scope};
  }

  async loadSavedConnection() {
    const saved=await this.vault.load("family",CONNECTION_COLLECTION,CONNECTION_ID);
    if(!saved?.value?.refreshToken)throw new Error("尚未連接 Dropbox，請先授權。");
    this.refreshToken=saved.value.refreshToken;
    this.connectionVersion=saved.version;
    return {accountId:saved.value.accountId||null,scope:saved.value.scope||""};
  }

  async getAccessToken() {
    if(this.accessToken&&this.expiresAt>Date.now()+60_000)return this.accessToken;
    if(!this.refreshToken)await this.loadSavedConnection();
    const tokens=await this.oauth.refresh(this.refreshToken);
    this.refreshToken=tokens.refreshToken;
    this.accessToken=tokens.accessToken;
    this.expiresAt=tokens.expiresAt;
    const current=await this.vault.load("family",CONNECTION_COLLECTION,CONNECTION_ID);
    const record={
      ...(current?.value||{}),
      provider:"dropbox",
      refreshToken:this.refreshToken,
      accountId:tokens.accountId||current?.value?.accountId||null,
      scope:tokens.scope||current?.value?.scope||"",
      updatedAt:new Date().toISOString()
    };
    const saved=await this.vault.save("family",CONNECTION_COLLECTION,CONNECTION_ID,1,record,current?.version??null);
    this.connectionVersion=saved.version;
    return this.accessToken;
  }

  async sync(scope="family") {
    if(!this.refreshToken)await this.loadSavedConnection();
    return syncDropboxVault(this.vault.cache,this.adapter,scope);
  }

  clearSession() {
    this.accessToken=null;
    this.expiresAt=0;
    this.refreshToken=null;
    this.connectionVersion=null;
  }
}
