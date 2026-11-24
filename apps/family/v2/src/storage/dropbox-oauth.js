const STATE_KEY = "family-vault-dropbox-oauth";
const TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";
const AUTHORIZE_ENDPOINT = "https://www.dropbox.com/oauth2/authorize";
const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function randomUrlSafe(bytes = 64) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function challengeFor(verifier) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(verifier))));
}

/**
 * Dropbox OAuth Authorization Code + PKCE.
 * Access tokens stay in memory; refresh tokens must be stored encrypted by VaultService.
 * Dropbox recommends PKCE for pure-JavaScript/browser apps; never embed a client secret.
 */
export class DropboxOAuthClient {
  constructor({ appKey, redirectUri, storage = sessionStorage, fetchImpl = fetch }) {
    if (!appKey) throw new Error("尚未設定 Dropbox App Key。");
    if (!redirectUri) throw new Error("尚未設定 Dropbox OAuth Redirect URI。");
    this.appKey = appKey;
    this.redirectUri = redirectUri;
    this.storage = storage;
    this.fetchImpl = fetchImpl;
  }

  async getAuthorizeUrl() {
    const verifier = randomUrlSafe(64);
    const state = randomUrlSafe(32);
    const challenge = await challengeFor(verifier);
    this.storage.setItem(STATE_KEY, JSON.stringify({ verifier, state, redirectUri: this.redirectUri }));
    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set("client_id", this.appKey);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("token_access_type", "offline");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async completeAuthorization(search = location.search) {
    const params = new URLSearchParams(search);
    const error = params.get("error_description") || params.get("error");
    if (error) throw new Error("Dropbox 授權失敗："+error);
    const code = params.get("code");
    const returnedState = params.get("state");
    if (!code || !returnedState) throw new Error("Dropbox 沒有返回授權碼或 state。");
    const raw = this.storage.getItem(STATE_KEY);
    if (!raw) throw new Error("找不到 OAuth 暫存狀態，請重新連接 Dropbox。");
    const saved = JSON.parse(raw);
    if (saved.state !== returnedState || saved.redirectUri !== this.redirectUri) {
      this.storage.removeItem(STATE_KEY);
      throw new Error("Dropbox OAuth state 不匹配，已中止授權。");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.appKey,
      redirect_uri: this.redirectUri,
      code_verifier: saved.verifier
    });
    const response = await this.fetchImpl(TOKEN_ENDPOINT,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body
    });
    const payload = await response.json().catch(()=>({}));
    this.storage.removeItem(STATE_KEY);
    if (!response.ok) throw new Error("Dropbox Token 交換失敗："+(payload.error_description||payload.error||response.status));
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || null,
      expiresAt: Date.now() + Number(payload.expires_in||14400)*1000,
      accountId: payload.account_id || null,
      scope: payload.scope || ""
    };
  }

  async refresh(refreshToken) {
    if (!refreshToken) throw new Error("缺少 Dropbox Refresh Token，請重新授權。");
    const body = new URLSearchParams({
      grant_type:"refresh_token",
      refresh_token:refreshToken,
      client_id:this.appKey
    });
    const response=await this.fetchImpl(TOKEN_ENDPOINT,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error("Dropbox Token 更新失敗："+(payload.error_description||payload.error||response.status));
    return {
      accessToken:payload.access_token,
      refreshToken:payload.refresh_token||refreshToken,
      expiresAt:Date.now()+Number(payload.expires_in||14400)*1000,
      accountId:payload.account_id||null,
      scope:payload.scope||""
    };
  }
}
