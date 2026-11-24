import { VaultService } from "./core/vault-service.js";
import { createId, nowIso } from "./core/id.js";
import { buildRelationshipIndex } from "./core/relationship-index.js";
import { validateFamilyData } from "./core/validate.js";
import { exportEncryptedBackup, inspectEncryptedBackup, applyEncryptedBackup } from "./core/backup.js";
import { DropboxConnectionService } from "./storage/dropbox-connection-service.js";
import { DROPBOX_APP_KEY } from "./storage/dropbox-config.js";

const $ = id => document.getElementById(id);
const vault = new VaultService();
let persons = [], relationships = [], selectedId = null, selectedVersion = null, editing = false;
let dropbox = null, dropboxConnected = false;

function message(text, error = false) {
  $("saveStatus").textContent = text;
  $("saveStatus").style.color = error ? "#ffaaaa" : "#9bd8b2";
}
function personById(id) { return persons.find(p => p.id === id); }
function safeText(value) {
  return String(value || "").replace(/[&<>"']/g, ch => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

async function loadAll() {
  persons = [];
  relationships = [];
  const pItems = await vault.cache.list("persons");
  for (const item of pItems) {
    if (!item.objectId.startsWith("family:persons:")) continue;
    const id = item.objectId.slice("family:persons:".length);
    const loaded = await vault.load("family", "persons", id);
    if (loaded) persons.push(loaded.value);
  }
  const rItems = await vault.cache.list("relationships");
  for (const item of rItems) {
    if (!item.objectId.startsWith("family:relationships:")) continue;
    const id = item.objectId.slice("family:relationships:".length);
    const loaded = await vault.load("family", "relationships", id);
    if (loaded) relationships.push(loaded.value);
  }
  persons.sort((a,b)=>(a.name||"").localeCompare(b.name||"","zh-Hant"));
  renderPeople();
  if (selectedId && personById(selectedId)) showPerson(selectedId);
  else clearDetail();
}

function renderPeople() {
  $("peopleCount").textContent = persons.length + " 位人物";
  const q = $("search").value.trim().toLocaleLowerCase();
  const list = persons.filter(p => [p.name,p.birthplace,p.occupation,p.biography].join(" ").toLocaleLowerCase().includes(q));
  $("peopleList").innerHTML = list.map(p => `<button class="personItem ${p.id===selectedId?"active":""}" data-id="${safeText(p.id)}"><span class="avatar">${safeText((p.name||"?").slice(0,1))}</span><span><strong>${safeText(p.name)}</strong><small>${safeText(p.birthDate||p.birthplace||"")}</small></span></button>`).join("");
  document.querySelectorAll(".personItem").forEach(el => el.addEventListener("click", () => showPerson(el.dataset.id)));
}
function clearDetail() {
  selectedId = null; selectedVersion = null; editing = false;
  $("emptyDetail").hidden = false; $("personForm").hidden = true; $("relationsSection").hidden = true;
  renderPeople();
}
function fillForm(p) {
  $("name").value = p.name || ""; $("gender").value = p.gender || "unknown";
  $("generation").value = p.generation || ""; $("siblingOrder").value = p.siblingOrder || "";
  $("birthDate").value = p.birthDate || ""; $("deathDate").value = p.deathDate || "";
  $("birthplace").value = p.birthplace || ""; $("residence").value = p.residence || "";
  $("occupation").value = p.occupation || ""; $("biography").value = p.biography || "";
}
async function showPerson(id) {
  const p = personById(id); if (!p) return;
  selectedId = id; editing = false;
  const stored = await vault.cache.get("family:persons:" + id);
  selectedVersion = stored?.version ?? null;
  $("emptyDetail").hidden = true; $("personForm").hidden = false; $("relationsSection").hidden = false;
  $("formTitle").textContent = p.name; fillForm(p); message("已載入加密資料");
  renderPeople(); renderRelations();
}
function newPerson() {
  selectedId = null; selectedVersion = null; editing = true;
  $("emptyDetail").hidden = true; $("personForm").hidden = false; $("relationsSection").hidden = true;
  $("formTitle").textContent = "新增人物";
  $("personForm").reset(); $("gender").value = "unknown"; message("尚未保存");
  $("name").focus();
}
async function savePerson(event) {
  event.preventDefault();
  const name = $("name").value.trim();
  if (!name) return message("請填寫姓名", true);
  const old = selectedId ? personById(selectedId) : null;
  const stamp = nowIso();
  const p = {
    schemaVersion:1,id:old?.id || createId("P"),name,
    gender:$("gender").value || "unknown",generation:$("generation").value.trim(),
    siblingOrder:$("siblingOrder").value ? Number($("siblingOrder").value) : null,
    birthDate:$("birthDate").value || null,deathDate:$("deathDate").value || null,
    birthplace:$("birthplace").value.trim(),residence:$("residence").value.trim(),
    occupation:$("occupation").value.trim(),biography:$("biography").value.trim(),
    alternateNames:old?.alternateNames||[],notes:old?.notes||"",
    createdAt:old?.createdAt||stamp,updatedAt:stamp
  };
  const nextData={persons:[...persons.filter(x=>x.id!==p.id),p],relationships,events:[],media:[],sources:[]};
  const checked=validateFamilyData(nextData);
  if(!checked.valid) return message(checked.errors[0],true);
  try {
    const result=await vault.save("family","persons",p.id,1,p,old?selectedVersion:null);
    if(old) persons=persons.map(x=>x.id===p.id?p:x); else persons.push(p);
    selectedId=p.id;selectedVersion=result.version;editing=false;
    $("formTitle").textContent=p.name;$("relationsSection").hidden=false;
    message("已加密保存");renderPeople();renderRelations();
  } catch(error) {
    message(error.message==="LOCAL_VERSION_CONFLICT"?"資料版本已改變，請重新載入後再保存。":"保存失敗："+error.message,true);
  }
}
function renderRelations() {
  if (!selectedId) return;
  const index=buildRelationshipIndex(persons,relationships);
  const linked=new Map();
  for(const id of index.parents.get(selectedId)||[]) linked.set(id,"父母");
  for(const id of index.children.get(selectedId)||[]) linked.set(id,"子女");
  for(const id of index.spouses.get(selectedId)||[]) linked.set(id,"配偶");
  for(const id of index.guardians.get(selectedId)||[]) linked.set(id,"監護人");
  $("relationsList").innerHTML=[...linked].map(([id,label])=>`<div class="relationRow"><span>${safeText(label)}：${safeText(personById(id)?.name||"未知人物")}</span><span>${safeText(id.slice(0,10))}</span></div>`).join("")||'<p class="muted">尚未建立親屬關係。</p>';
  $("relationPerson").innerHTML='<option value="">選擇另一位人物</option>'+persons.filter(p=>p.id!==selectedId).map(p=>`<option value="${safeText(p.id)}">${safeText(p.name)}</option>`).join("");
}
async function addRelation() {
  const otherId=$("relationPerson").value,type=$("relationType").value;
  if(!selectedId||!otherId)return;
  const exists=relationships.some(r=>r.type===type&&r.fromPersonId===selectedId&&r.toPersonId===otherId);
  if(exists)return;
  const rel={schemaVersion:1,id:createId("R"),fromPersonId:selectedId,toPersonId:otherId,type,status:"reported",validFrom:null,validTo:null,notes:"",sourceIds:[],createdAt:nowIso(),updatedAt:nowIso()};
  const checked=validateFamilyData({persons,relationships:[...relationships,rel],events:[],media:[],sources:[]});
  if(!checked.valid)return message(checked.errors[0],true);
  try {
    await vault.save("family","relationships",rel.id,1,rel,null);
    relationships.push(rel);renderRelations();message("親屬關係已加密保存");
  } catch(error) { message("關係保存失敗："+error.message,true); }
}

async function start() {
  const status=await vault.status("family");
  $("gateTitle").textContent=status.exists?"解鎖家庭資料保險庫":"建立家庭資料保險庫";
  $("gateDesc").textContent=status.exists?"輸入保險庫密碼，在本機解鎖加密家庭資料。":"請設定至少 12 個字元的高強度密碼。此版本只保存加密本機資料，尚未啟用雲端同步。";
  $("passwordLabel").firstChild.textContent=status.exists?"保險庫密碼":"設定保險庫密碼";
  $("confirmWrap").hidden=status.exists;
  $("gateSubmit").textContent=status.exists?"解鎖":"建立加密保險庫";
  $("gateForm").addEventListener("submit",async event=>{
    event.preventDefault();$("gateError").textContent="";
    const password=$("vaultPassword").value;
    try {
      if(status.exists) await vault.unlock("family",password);
      else {
        if(password!==$("vaultConfirm").value) throw new Error("兩次輸入的密碼不一致。");
        await vault.create("family",password);
      }
      $("gate").hidden=true;$("workspace").hidden=false;$("lockBtn").hidden=false;
      await loadAll();await updateHealthState();await setupDropbox();
    } catch(error) {$("gateError").textContent=error.message||"操作失敗";}
    finally {$("vaultPassword").value="";$("vaultConfirm").value="";}
  });
  $("lockBtn").addEventListener("click",()=>{dropbox?.clearSession();dropboxConnected=false;vault.lock();$("workspace").hidden=true;$("gate").hidden=false;$("lockBtn").hidden=true;$("gateTitle").textContent="解鎖家庭資料保險庫";$("gateDesc").textContent="請重新輸入密碼。";$("passwordLabel").firstChild.textContent="保險庫密碼";$("confirmWrap").hidden=true;$("gateSubmit").textContent="解鎖";});
  $("addPersonBtn").addEventListener("click",newPerson);$("emptyAdd").addEventListener("click",newPerson);
  $("cancelEdit").addEventListener("click",()=>selectedId?showPerson(selectedId):clearDetail());
  $("personForm").addEventListener("submit",savePerson);
  $("search").addEventListener("input",renderPeople);
  $("addRelation").addEventListener("click",addRelation);
  $("healthUnlock").addEventListener("click",unlockHealth);
  $("connectDropboxBtn").addEventListener("click",connectDropbox);
  $("syncFamilyBtn").addEventListener("click",()=>syncCloud("family"));
  $("syncMedicalBtn").addEventListener("click",()=>syncCloud("medical"));
  $("exportBackupBtn").addEventListener("click",downloadBackup);
  $("restoreBtn").addEventListener("click",restoreBackup);
}


async function setupDropbox() {
  if(!DROPBOX_APP_KEY) {
    $("dropboxStatus").textContent="尚未設定 App Key；Dropbox 雲端功能暫未啟用。";
    $("connectDropboxBtn").disabled=true;
    $("syncFamilyBtn").disabled=true;
    $("syncMedicalBtn").disabled=true;
    $("connectDropboxBtn").textContent="等待設定 App Key";
    return;
  }
  try {
    dropbox=new DropboxConnectionService({vault,appKey:DROPBOX_APP_KEY});
    const params=new URLSearchParams(location.search);
    if(params.has("code")||params.has("error")) {
      const result=await dropbox.completeAuthorization(location.search);
      history.replaceState(null,"",location.pathname);
      $("dropboxStatus").textContent="Dropbox 已連接 · "+(result.accountId||"帳戶已授權")+"（短效工作階段）";
      dropboxConnected=true;
      $("connectDropboxBtn").textContent="重新授權";
      $("syncFamilyBtn").disabled=false;
      const medical=await vault.status("medical");
      $("syncMedicalBtn").hidden=!medical.exists;
      $("syncMedicalBtn").disabled=!medical.unlocked;
    } else {
      $("dropboxStatus").textContent="尚未連接；每次新工作階段需重新授權。";
      dropboxConnected=false;
      $("connectDropboxBtn").textContent="連接 Dropbox";
      $("connectDropboxBtn").disabled=false;
      $("syncFamilyBtn").disabled=true;
      $("syncMedicalBtn").disabled=true;
    }
  } catch(error) {
    if(location.search.includes("code=")||location.search.includes("error=")) {
      $("dropboxStatus").textContent="Dropbox 授權處理失敗："+error.message;
      history.replaceState(null,"",location.pathname);
    } else {
      $("dropboxStatus").textContent="尚未連接 Dropbox："+error.message;
    }
    dropboxConnected=false;
    $("connectDropboxBtn").textContent="連接 Dropbox";
    $("connectDropboxBtn").disabled=false;
    $("syncFamilyBtn").disabled=true;
    $("syncMedicalBtn").disabled=true;
  }
}
async function connectDropbox() {
  if(!dropbox) {
    try { dropbox=new DropboxConnectionService({vault,appKey:DROPBOX_APP_KEY}); }
    catch(error) { alert(error.message);return; }
  }
  try { location.assign(await dropbox.beginAuthorization()); }
  catch(error) { alert("無法開始 Dropbox 授權："+error.message); }
}
async function syncCloud(scope) {
  if(!dropboxConnected||!dropbox)return;
  if(scope==="medical"&&!(await vault.status("medical")).unlocked) {
    alert("請先解鎖醫療保險庫，再同步醫療資料。");return;
  }
  const button=scope==="family"?$("syncFamilyBtn"):$("syncMedicalBtn");
  const original=button.textContent;button.disabled=true;button.textContent="同步中…";
  try {
    const result=await dropbox.sync(scope);
    $("dropboxStatus").textContent=scope==="family"
      ? `家庭同步完成：上傳 ${result.uploaded}、下載 ${result.downloaded}、衝突 ${result.conflicts.length}`
      : `醫療同步完成：上傳 ${result.uploaded}、下載 ${result.downloaded}、衝突 ${result.conflicts.length}`;
    if(result.conflicts.length) {
      const detail=result.conflicts.slice(0,5).map(x=>x.objectId+": "+x.reason).join("\\n");
      alert("有 "+result.conflicts.length+" 筆資料需要人工處理，系統沒有覆蓋任何衝突資料。\\n"+detail);
    }
    if(scope==="family")await loadAll();
  } catch(error) {
    $("dropboxStatus").textContent="同步失敗："+error.message;
    if(error.name==="StorageAuthorizationError"||error.message.includes("短效授權已過期")) {
      dropbox?.clearSession();dropboxConnected=false;
      $("connectDropboxBtn").textContent="重新連接 Dropbox";
      $("syncFamilyBtn").disabled=true;$("syncMedicalBtn").disabled=true;
    }
    alert("Dropbox 同步失敗："+error.message);
  } finally {
    button.textContent=original;
    button.disabled=!dropboxConnected;
  }
}

async function downloadBackup() {
  try {
    const includeMedical=$("includeMedical").checked;
    if(includeMedical && !(await vault.status("medical")).unlocked) {
      alert("請先解鎖醫療保險庫，再匯出包含醫療資料的備份。");
      return;
    }
    const blob=await exportEncryptedBackup(vault.cache,{includeMedical});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="家庭資料庫加密備份_"+new Date().toISOString().slice(0,10)+".familyvault";
    a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    alert("加密備份已產生。請另存到安全位置；這份檔案仍需保險庫密碼才能解密。");
  } catch(error) { alert("備份匯出失敗："+error.message); }
}
async function restoreBackup() {
  const file=$("restoreInput").files?.[0];
  if(!file){alert("請先選擇 .familyvault 備份檔。");return;}
  try {
    const plan=await inspectEncryptedBackup(file);
    const health=plan.preview.scopes.includes("medical")?"，包含獨立醫療保險庫":"";
    const ok=confirm("備份日期："+plan.preview.createdAt+"\n加密物件："+plan.preview.objectCount+" 筆"+health+"\n\n還原採新增模式，不會覆蓋本機既有資料。是否繼續？");
    if(!ok)return;
    const result=await applyEncryptedBackup(vault.cache,plan);
    alert("還原完成：新增 "+result.restored+" 筆；衝突／保留未覆蓋 "+result.conflicts.length+" 筆。\n重新載入後，使用備份原本的密碼解鎖。");
    location.reload();
  } catch(error) { alert("備份檢查／還原失敗："+error.message); }
  finally { $("restoreInput").value=""; }
}

async function updateHealthState() {
  const status=await vault.status("medical");
  $("healthState").textContent=status.unlocked?"已解鎖":status.exists?"已建立／已鎖定":"尚未建立";
  $("healthUnlock").textContent=status.unlocked?"鎖定醫療保險庫":status.exists?"解鎖醫療保險庫":"建立醫療保險庫";
  $("syncMedicalBtn").hidden=!status.exists;
  $("syncMedicalBtn").disabled=!dropboxConnected||!status.unlocked;
}
async function unlockHealth() {
  const status=await vault.status("medical");
  if(status.unlocked){vault.lock("medical");await updateHealthState();return;}
  const password=prompt(status.exists?"輸入醫療保險庫密碼：":"設定獨立醫療保險庫密碼（至少 12 個字元）：");
  if(!password)return;
  try {
    if(status.exists) await vault.unlock("medical",password);
    else await vault.create("medical",password);
    await updateHealthState();
    alert("醫療保險庫已解鎖。醫療紀錄管理介面尚在開發，現在不會新增任何健康資料。");
  } catch(error) { alert("醫療保險庫操作失敗："+error.message); }
}
start().catch(error=>{$("gateError").textContent="啟動失敗："+error.message;});
