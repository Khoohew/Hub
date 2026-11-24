import { createStoredZip, readStoredZip } from "./zip-store.js";
import { unlockVaultKey, decryptJson } from "./crypto.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const META_FAMILY = "vault:family:descriptor";
const META_MEDICAL = "vault:medical:descriptor";

function toBase64(bytes) {
  let binary="";
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary);
}
function fromBase64(value) {
  const binary=atob(value),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function jsonBytes(value) {
  const text=JSON.stringify(value,(_key,item)=>item instanceof Uint8Array?{$familyVaultBytes:toBase64(item)}:item);
  return encoder.encode(text);
}
function parseJsonBytes(bytes) {
  return JSON.parse(decoder.decode(bytes),(_key,item)=>item&&typeof item==="object"&&typeof item.$familyVaultBytes==="string"?fromBase64(item.$familyVaultBytes):item);
}
async function sha256Hex(bytes) {
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return [...digest].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function safeObjectPath() { return "objects/"+crypto.randomUUID()+".json"; }

/** Build a self-contained backup containing ciphertext only. */
export async function exportEncryptedBackup(cache,{includeMedical=false,sealManifest}={}) {
  if(typeof sealManifest!=="function")throw new Error("匯出備份前必須使用家庭保險庫金鑰認證 manifest。");
  const family=await cache.getMeta(META_FAMILY);
  if(!family)throw new Error("找不到家庭保險庫設定。");
  const descriptors=[family];
  if(includeMedical){
    const medical=await cache.getMeta(META_MEDICAL);
    if(medical)descriptors.push(medical);
  }
  const scopes=new Set(descriptors.map(x=>x.scope));
  const stored=await cache.list();
  const entries=[],manifestFiles=[];
  const descriptorBytes=jsonBytes(descriptors);
  entries.push({name:"vaults.json",data:descriptorBytes});
  manifestFiles.push({path:"vaults.json",sha256:await sha256Hex(descriptorBytes),size:descriptorBytes.length});
  let objectCount=0;
  for(const item of stored){
    const parts=item.objectId.split(":");
    const scope=parts[0],collection=parts[1];
    if(!scopes.has(scope))continue;
    const record=await cache.get(item.objectId);
    if(!record?.envelope)continue;
    const data=jsonBytes({version:record.version,updatedAt:record.updatedAt,envelope:record.envelope});
    const path=safeObjectPath();
    entries.push({name:path,data});
    manifestFiles.push({path,sha256:await sha256Hex(data),size:data.length});
    objectCount++;
  }
  const manifest={
    format:"family-vault-backup",
    formatVersion:2,
    createdAt:new Date().toISOString(),
    encryption:"AES-256-GCM",
    objectCount,
    files:manifestFiles
  };
  manifest.seal=await sealManifest(manifest);
  entries.push({name:"manifest.json",data:encoder.encode(JSON.stringify(manifest,null,2))});
  const zip=createStoredZip(entries);
  return new Blob([zip],{type:"application/zip"});
}

/** Validate an archive and return a preview plan. This function does not write anything. */
export async function inspectEncryptedBackup(fileOrBytes) {
  const bytes=fileOrBytes instanceof Uint8Array?fileOrBytes:new Uint8Array(await fileOrBytes.arrayBuffer());
  const entries=readStoredZip(bytes);
  if(!entries.has("manifest.json")||!entries.has("vaults.json"))throw new Error("備份缺少必要索引檔。");
  const manifest=parseJsonBytes(entries.get("manifest.json"));
  if(manifest.format!=="family-vault-backup"||manifest.formatVersion!==2||!manifest.seal)throw new Error("不支援此備份版本或缺少清單認證。");
  if(!Array.isArray(manifest.files)||manifest.files.length!==entries.size-1)throw new Error("備份檔案清單與 ZIP 內容不一致。");
  const listed=new Set();
  for(const file of manifest.files){
    if(!file.path||file.path.startsWith("/")||file.path.split("/").includes("..")||listed.has(file.path))throw new Error("備份索引含有不安全路徑。");
    listed.add(file.path);
    const data=entries.get(file.path);
    if(!data)throw new Error("備份檔案缺失："+file.path);
    if(data.length!==file.size||await sha256Hex(data)!==file.sha256)throw new Error("備份完整性驗證失敗："+file.path);
  }
  for(const name of entries.keys())if(name!=="manifest.json"&&!listed.has(name))throw new Error("ZIP 中存在未列入索引的檔案。");
  const descriptors=parseJsonBytes(entries.get("vaults.json"));
  if(!Array.isArray(descriptors)||!descriptors.some(x=>x.scope==="family"))throw new Error("備份缺少家庭保險庫金鑰資訊。");
  const descriptorByVault=new Map(descriptors.map(x=>[x.vaultId,x]));
  const objects=[],seen=new Set();
  for(const path of listed){
    if(!path.startsWith("objects/"))continue;
    const stored=parseJsonBytes(entries.get(path));
    const envelope=stored.envelope;
    if(!envelope||envelope.formatVersion!==1||envelope.algorithm!=="AES-256-GCM")throw new Error("備份包含無效的加密物件。");
    const descriptor=descriptorByVault.get(envelope.vaultId);
    if(!descriptor)throw new Error("加密物件找不到對應的保險庫。");
    const objectId=descriptor.scope+":"+envelope.collection+":"+envelope.recordId;
    if(seen.has(objectId))throw new Error("備份內有重複資料物件。");
    seen.add(objectId);
    objects.push({objectId,scope:descriptor.scope,collection:envelope.collection,recordId:envelope.recordId,version:stored.version||1,updatedAt:stored.updatedAt||null,envelope});
  }
  if(objects.length!==manifest.objectCount)throw new Error("備份物件數量與索引不一致。");
  return {manifest,descriptors,objects,verified:false,preview:{createdAt:manifest.createdAt,objectCount:objects.length,scopes:descriptors.map(x=>x.scope)}};
}

/** Authenticate the manifest with the family vault password before any restore writes. */
export async function verifyEncryptedBackup(plan,passphrase) {
  const descriptor=plan?.descriptors?.find(item=>item.scope==="family");
  if(!descriptor||!plan.manifest?.seal)throw new Error("備份缺少家庭保險庫清單認證。");
  try {
    const key=await unlockVaultKey(passphrase,descriptor);
    const context={vaultId:descriptor.vaultId,collection:"backup-manifest",recordId:"manifest",schemaVersion:1};
    const authenticated=await decryptJson(key,plan.manifest.seal,context);
    const payload={...plan.manifest};
    delete payload.seal;
    if(JSON.stringify(authenticated)!==JSON.stringify(payload))throw new Error("MANIFEST_MISMATCH");
    return {...plan,verified:true};
  } catch {
    throw new Error("家庭保險庫密碼錯誤，或備份清單已被修改。");
  }
}

/** Restore is additive only: existing objects and different vault IDs are never overwritten. */
export async function applyEncryptedBackup(cache,plan) {
  if(plan?.verified!==true)throw new Error("還原前必須先驗證備份清單。");
  const conflicts=[],restored=[];
  const usableScopes=new Set();
  for(const descriptor of plan.descriptors){
    const key=descriptor.scope==="family"?META_FAMILY:descriptor.scope==="medical"?META_MEDICAL:null;
    if(!key)continue;
    const current=await cache.getMeta(key);
    if(!current){await cache.setMeta(key,descriptor);usableScopes.add(descriptor.scope);}
    else if(current.vaultId===descriptor.vaultId){usableScopes.add(descriptor.scope);}
    else conflicts.push({scope:descriptor.scope,reason:"此裝置已存在另一個保險庫，未覆蓋。"});
  }
  for(const object of plan.objects){
    if(!usableScopes.has(object.scope)){conflicts.push({objectId:object.objectId,reason:"對應保險庫未還原。"});continue;}
    try{
      await cache.put(object.objectId,object.collection,object.envelope,"absent");
      restored.push(object.objectId);
    }catch(error){
      if(error.message==="LOCAL_VERSION_CONFLICT")conflicts.push({objectId:object.objectId,reason:"本機已有同一筆資料，保留原資料。"});
      else throw error;
    }
  }
  return {restored:restored.length,conflicts};
}
