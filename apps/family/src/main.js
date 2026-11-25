import { VaultService } from "./core/vault-service.js";
import { createId, nowIso } from "./core/id.js";
import { buildRelationshipIndex } from "./core/relationship-index.js";
import { validateFamilyData } from "./core/validate.js";
import { exportEncryptedBackup, inspectEncryptedBackup, verifyEncryptedBackup, applyEncryptedBackup } from "./core/backup.js";
import { GitHubReleaseStorage } from "./storage/github-release-storage.js?v=20261125d";
import { GitHubPlainContentsCache } from "./storage/github-plain-contents-cache.js";
import { buildTreeLayout } from "./core/tree-layout.js";
import { validateMedicalRecord } from "./core/medical-validation.js";

const $ = id => document.getElementById(id);
const vault = new VaultService();
let persons = [], relationships = [], events = [], mediaItems = [], selectedId = null, selectedVersion = null, editing = false;
let selectedEventId = null, selectedEventVersion = null;
let medicalRecords = [], medicalMediaItems = [], selectedMedicalId = null, selectedMedicalVersion = null;
let mediaObjectUrls = new Map();
let treeZoom = 1.15;
let githubStorage = null;

function message(text, error = false) {
  $("saveStatus").textContent = text;
  $("saveStatus").style.color = error ? "#a8332b" : "#4d7a47";
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
  events = [];
  mediaItems = [];
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
  const eItems = await vault.cache.list("events");
  for (const item of eItems) {
    if (!item.objectId.startsWith("family:events:")) continue;
    const id = item.objectId.slice("family:events:".length);
    const loaded = await vault.load("family", "events", id);
    if (loaded) events.push(loaded.value);
  }
  const mItems = await vault.cache.list("media");
  for (const item of mItems) {
    if (!item.objectId.startsWith("family:media:")) continue;
    const id = item.objectId.slice("family:media:".length);
    const loaded = await vault.load("family", "media", id);
    if (loaded) mediaItems.push(loaded.value);
  }
  persons.sort((a,b)=>(a.name||"").localeCompare(b.name||"","zh-Hant"));
  renderPeople();
  if (selectedId && personById(selectedId)) showPerson(selectedId);
  else clearDetail();
}

function renderTree() {
  const center=selectedId||persons[0]?.id;
  const host=$("treeSvg");
  const viewport=$("treeViewport");
  const info=$("treeInfo");
  const viewportWidth=Math.max(1,viewport.clientWidth||700);
  const viewportHeight=Math.max(1,viewport.clientHeight||520);
  const padX=viewportWidth;
  const padY=viewportHeight;

  if(!center){
    const stageWidth=Math.ceil(viewportWidth*3);
    const stageHeight=Math.ceil(viewportHeight*3);
    host.setAttribute("width",String(stageWidth));
    host.setAttribute("height",String(stageHeight));
    host.setAttribute("viewBox","0 0 "+stageWidth+" "+stageHeight);
    host.innerHTML='<text x="'+(stageWidth/2)+'" y="'+(stageHeight/2)+'" text-anchor="middle" class="treeEmpty">新增人物並建立關係後，族譜會顯示在這裡</text>';
    viewport.scrollLeft=viewportWidth;
    viewport.scrollTop=viewportHeight;
    info.textContent="目前沒有可顯示的人物";
    $("treeCenter").textContent="—";$("treeZoomLabel").textContent=Math.round(treeZoom*100)+"%";
    return;
  }

  const layout=buildTreeLayout(persons,relationships,center);
  if(!layout.nodes.length)return;
  const nodeById=new Map(layout.nodes.map(node=>[node.id,node]));
  const edgeMarkup=layout.edges.map(edge=>{
    const a=nodeById.get(edge.from),b=nodeById.get(edge.to);
    if(!a||!b)return "";
    let d;
    if(edge.type==="spouse_of"||edge.type==="sibling_of"){
      const left=a.x<=b.x?a:b,right=a.x<=b.x?b:a;
      d="M "+(left.x+left.width)+" "+(left.y+38)+" L "+right.x+" "+(right.y+38);
    }else{
      const parent=edge.type==="parent_of"||edge.type==="adoptive_parent_of"?a:a;
      const child=edge.type==="parent_of"||edge.type==="adoptive_parent_of"?b:b;
      const x1=parent.x+parent.width/2,y1=parent.y+parent.height,x2=child.x+child.width/2,y2=child.y;
      const ym=y1+(y2-y1)/2;
      d="M "+x1+" "+y1+" V "+ym+" H "+x2+" V "+y2;
    }
    let label="";
    if(edge.type==="spouse_of"){
      const left=a.x<=b.x?a:b,right=a.x<=b.x?b:a;
      const mx=(left.x+left.width+right.x)/2,my=left.y+38;
      label='<rect class="treeTag" x="'+(mx-13)+'" y="'+(my-7)+'" width="26" height="14" rx="7"/><text class="treeTagText" x="'+mx+'" y="'+my+'">夫妻</text>';
    }
    return '<path class="treeEdge '+edge.type+'" d="'+d+'"/>'+label;
  }).join("");
  const nodeMarkup=layout.nodes.map(node=>{
    const person=node.person,detail=[person.birthDate,person.deathDate?"卒 "+person.deathDate:""].filter(Boolean).join(" · ");
    const selected=node.id===selectedId?" selected":"";
    const initial=safeText((person.name||"?").slice(0,1));
    return '<g class="treeNode'+selected+'" data-id="'+safeText(node.id)+'" transform="translate('+node.x+','+node.y+')"><rect class="nodeBox" width="'+node.width+'" height="'+node.height+'" rx="10"/><circle class="treeAvatar" cx="27" cy="27" r="13"/><text class="treeAvatarText" x="27" y="27">'+initial+'</text><text class="treeName" x="48" y="32">'+safeText(person.name||"未命名")+'</text><text class="treeDetail" x="14" y="60">'+safeText(detail||"日期未記錄")+'</text></g>';
  }).join("");

  const scaledWidth=layout.width*treeZoom;
  const scaledHeight=layout.height*treeZoom;
  const centeredX=Math.max(0,(viewportWidth-scaledWidth)/2);
  const centeredY=Math.max(0,(viewportHeight-scaledHeight)/2);
  const contentX=padX+centeredX;
  const contentY=padY+centeredY;
  const stageWidth=Math.ceil(Math.max(viewportWidth,scaledWidth)+padX*2);
  const stageHeight=Math.ceil(Math.max(viewportHeight,scaledHeight)+padY*2);
  host.setAttribute("width",String(stageWidth));
  host.setAttribute("height",String(stageHeight));
  host.setAttribute("viewBox","0 0 "+stageWidth+" "+stageHeight);
  host.innerHTML='<g transform="translate('+contentX+','+contentY+') scale('+treeZoom+')">'+edgeMarkup+nodeMarkup+'</g>';
  info.textContent="單擊選取 · 空白拖動畫布 · 滾輪縮放 · 顯示上下三代"+(layout.truncated?" · 人物較多，已限制顯示範圍":"");
  $("treeCenter").textContent="「"+(personById(center)?.name||"所選人物")+"」";
  $("treeZoomLabel").textContent=Math.round(treeZoom*100)+"%";

  // Keep the complete tree centered initially, while leaving free space on all four sides for panning.
  viewport.scrollLeft=padX+Math.max(0,(scaledWidth-viewportWidth)/2);
  viewport.scrollTop=padY+Math.max(0,(scaledHeight-viewportHeight)/2);
}
function renderPeople() {
  $("peopleCount").textContent = "共 " + persons.length + " 人";
  const q = $("search").value.trim().toLocaleLowerCase();
  const list = persons.filter(p => [p.name,p.birthplace,p.occupation,p.biography].join(" ").toLocaleLowerCase().includes(q));
  $("peopleList").innerHTML = list.map(p => `<button class="personItem ${p.id===selectedId?"active":""}" data-id="${safeText(p.id)}"><span class="avatar">${safeText((p.name||"?").slice(0,1))}</span><span><strong>${safeText(p.name)}</strong><small>${safeText(p.birthDate||p.birthplace||"")}</small></span></button>`).join("");
  document.querySelectorAll(".personItem").forEach(el => el.addEventListener("click", () => showPerson(el.dataset.id)));
}
function clearDetail() {
  selectedId = null; selectedVersion = null; editing = false;
  $("emptyDetail").hidden = false; $("personForm").hidden = true; $("relationsSection").hidden = true; $("eventSection").hidden = true; $("mediaSection").hidden = true; $("medicalSection").hidden = true;
  const emptyTitle=$("emptyDetail").querySelector("h2"),emptyText=$("emptyDetail").querySelector("p"),emptyButton=$("emptyAdd");
  if(persons.length){
    emptyTitle.textContent="選擇家庭成員以編輯個人資料";
    emptyText.textContent="在左側家庭成員清單點選人物，個人資料表單就會顯示在右側；也可以新增人物。";
    emptyButton.textContent="＋ 新增人物";
  }else{
    emptyTitle.textContent="建立你的家庭資料";
    emptyText.textContent="先新增第一位人物，再逐步建立個人資料、親屬關係、家庭事件和照片檔案。";
    emptyButton.textContent="新增第一位人物";
  }
  resetEventForm();resetMedicalForm();clearMediaUrls();
  renderPeople();
}
function fillForm(p) {
  $("name").value = p.name || ""; $("gender").value = p.gender || "unknown";
  $("generation").value = p.generation || ""; $("siblingOrder").value = p.siblingOrder || "";
  $("birthDate").value = p.birthDate || ""; $("deathDate").value = p.deathDate || "";
  $("hasDeathDate").checked = !!p.deathDate; $("deathDateWrap").hidden = !p.deathDate;
  $("birthplace").value = p.birthplace || ""; $("residence").value = p.residence || "";
  $("occupation").value = p.occupation || ""; $("biography").value = p.biography || "";
}
async function showPerson(id) {
  const p = personById(id); if (!p) return;
  selectedId = id; editing = false;
  const stored = await vault.cache.get("family:persons:" + id);
  selectedVersion = stored?.version ?? null;
  $("emptyDetail").hidden = true; $("personForm").hidden = false; $("relationsSection").hidden = false; $("eventSection").hidden = false; $("mediaSection").hidden = false;
  resetEventForm();resetMedicalForm();
  $("formTitle").textContent = p.name; fillForm(p); $("deletePersonBtn").hidden = false; message("已載入家庭資料");
  renderPeople(); renderRelations(); renderTree(); renderEvents(); await renderMedia();
  await updateHealthState();
  if((await vault.status("medical")).unlocked)renderMedicalRecords();
}
async function deleteSelectedPerson() {
  const person=personById(selectedId);
  if(!person)return;
  const linkedMedia=mediaItems.filter(item=>(item.personIds||[]).includes(person.id));
  const linkedMedical=medicalRecords.filter(item=>item.personRef===person.id);
  if(linkedMedia.length){
    alert("此人物仍有 "+linkedMedia.length+" 件照片／文件附件。為避免誤刪原件，請先下載並刪除附件，或先將附件轉交其他人物，再刪除此人物。");
    return;
  }
  if(linkedMedical.length){
    alert("此人物仍有 "+linkedMedical.length+" 筆醫療紀錄。為避免誤刪醫療資料，請先處理這些紀錄，再刪除此人物。");
    return;
  }
  const linkedEvents=events.filter(item=>(item.personIds||[]).includes(person.id));
  const exclusiveEvents=linkedEvents.filter(item=>(item.personIds||[]).filter(id=>id!==person.id).length===0);
  const referencedEvents=exclusiveEvents.filter(item=>mediaItems.some(media=>(media.eventIds||[]).includes(item.id)));
  if(referencedEvents.length){
    alert("此人物有事件仍被附件引用，請先解除附件與事件的關聯，再刪除人物。");
    return;
  }
  const linkedRelations=relationships.filter(item=>item.fromPersonId===person.id||item.toPersonId===person.id);
  const summary=[
    "確定永久刪除人物「"+person.name+"」？",
    "",
    "將一併刪除："+linkedRelations.length+" 條親屬關係、"+exclusiveEvents.length+" 筆僅屬於此人物的人生事件。",
    "其他人物共同參與的事件會保留，並移除此人物的關聯。",
    "此操作會直接修改 GitHub 私人資料庫，無法一鍵復原。"
  ].join("\n");
  if(!confirm(summary))return;
  const personId=person.id;
  try{
    for(const relation of linkedRelations)await vault.delete("family","relationships",relation.id);
    for(const event of linkedEvents){
      const remaining=(event.personIds||[]).filter(id=>id!==personId);
      if(!remaining.length)await vault.delete("family","events",event.id);
      else{
        const next={...event,personIds:remaining,updatedAt:nowIso()};
        await vault.save("family","events",event.id,1,next,null);
        events=events.map(value=>value.id===event.id?next:value);
      }
    }
    await vault.delete("family","persons",personId,selectedVersion);
    persons=persons.filter(value=>value.id!==personId);
    relationships=relationships.filter(value=>value.fromPersonId!==personId&&value.toPersonId!==personId);
    events=events.filter(value=>(value.personIds||[]).length>0);
    selectedId=null;selectedVersion=null;editing=false;
    clearDetail();
    renderTree();renderPeople();
    message("人物及其關係已刪除");
  }catch(error){
    alert("刪除人物時發生錯誤："+error.message+"。資料可能只完成部分更新，請重新載入頁面核對。");
    try{await loadAll();}catch(reloadError){console.error(reloadError);}
  }
}

function newPerson() {
  selectedId = null; selectedVersion = null; editing = true;
  $("emptyDetail").hidden = true; $("personForm").hidden = false; $("relationsSection").hidden = true; $("eventSection").hidden = true; $("mediaSection").hidden = true; $("medicalSection").hidden = true;
  resetEventForm();resetMedicalForm();clearMediaUrls();
  $("formTitle").textContent = "新增人物";
  $("deletePersonBtn").hidden = true;
  $("personForm").reset(); $("gender").value = "unknown"; $("hasDeathDate").checked=false; $("deathDate").value=""; $("deathDateWrap").hidden=true; message("尚未保存");
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
    birthDate:$("birthDate").value || null,deathDate:$("hasDeathDate").checked?($("deathDate").value || null):null,
    birthplace:$("birthplace").value.trim(),residence:old?.residence||"",
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
    $("formTitle").textContent=p.name;$("deletePersonBtn").hidden=false;$("relationsSection").hidden=false;$("eventSection").hidden=false;$("mediaSection").hidden=false;
    message("已保存至 GitHub 私人倉庫（明文）");renderPeople();renderRelations();renderTree();renderEvents();await renderMedia();
    await updateHealthState();if((await vault.status("medical")).unlocked)renderMedicalRecords();
  } catch(error) {
    message(error.message==="REMOTE_VERSION_CONFLICT"?"資料版本已改變，請重新載入後再保存。":"保存失敗："+error.message,true);
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
    relationships.push(rel);renderRelations();renderTree();message("親屬關係已保存至 GitHub（明文）");
  } catch(error) { message("關係保存失敗："+error.message,true); }
}

const EVENT_LABELS={birth:"出生",death:"逝世",marriage:"婚姻",move:"遷居",education:"就學",career:"工作",military:"服役",reunion:"家族聚會",story:"家庭故事",other:"其他"};

function renderEventPersonOptions(selectedIds=[]) {
  const select=$("eventOtherPeople");
  const keep=new Set(selectedIds);
  select.innerHTML=persons.filter(person=>person.id!==selectedId)
    .map(person=>'<option value="'+safeText(person.id)+'"'+(keep.has(person.id)?" selected":"")+'>'+safeText(person.name)+'</option>').join("");
}

function eventDateLabel(event) {
  if(!event.date)return "日期未記錄";
  const date=event.date;
  if(event.datePrecision==="year")return date.slice(0,4)+" 年";
  if(event.datePrecision==="month")return date.slice(0,7).replace("-"," 年 ")+" 月";
  if(event.datePrecision==="approximate")return "約 "+date;
  return date;
}

function renderEvents() {
  if(!selectedId)return;
  renderEventPersonOptions([...$("eventOtherPeople").selectedOptions].map(option=>option.value));
  const host=$("eventList");
  host.replaceChildren();
  const records=events.filter(event=>(event.personIds||[]).includes(selectedId))
    .sort((a,b)=>String(a.date||"9999").localeCompare(String(b.date||"9999"))||String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
  if(!records.length){
    const empty=document.createElement("p");empty.className="muted";empty.textContent="尚未記錄此人物的人生事件。";host.append(empty);return;
  }
  for(const item of records){
    const card=document.createElement("article");card.className="eventCard";
    const head=document.createElement("div");head.className="eventHead";
    const title=document.createElement("strong");title.textContent=item.title;
    const type=document.createElement("span");type.className="eventType";type.textContent=EVENT_LABELS[item.type]||"其他";
    head.append(title,type);card.append(head);
    const meta=document.createElement("small");meta.textContent=eventDateLabel(item)+(item.location?" · "+item.location:"");card.append(meta);
    if(item.description){const desc=document.createElement("p");desc.textContent=item.description;card.append(desc);}
    const people=document.createElement("small");people.textContent="關聯人物："+(item.personIds||[]).map(id=>personById(id)?.name||"未知人物").join("、");card.append(people);
    const actions=document.createElement("div");actions.className="eventActions";
    const edit=document.createElement("button");edit.type="button";edit.className="secondary";edit.textContent="編輯";edit.addEventListener("click",()=>editEvent(item.id));
    const remove=document.createElement("button");remove.type="button";remove.className="secondary";remove.textContent="刪除";remove.addEventListener("click",()=>deleteEvent(item));
    actions.append(edit,remove);card.append(actions);host.append(card);
  }
}

function resetEventForm() {
  selectedEventId=null;selectedEventVersion=null;
  const form=$("eventForm");if(!form)return;
  form.reset();$("eventDatePrecision").value="unknown";
  $("eventSaveBtn").textContent="保存事件";$("eventCancelEdit").hidden=true;
  if(selectedId)renderEventPersonOptions([]);
}

async function editEvent(id) {
  const item=events.find(event=>event.id===id);if(!item)return;
  const stored=await vault.cache.get("family:events:"+id);
  selectedEventId=id;selectedEventVersion=stored?.version??null;
  $("eventType").value=item.type;$("eventTitle").value=item.title;
  $("eventDate").value=item.date||"";$("eventDatePrecision").value=item.datePrecision||"unknown";
  $("eventLocation").value=item.location||"";$("eventDescription").value=item.description||"";
  renderEventPersonOptions((item.personIds||[]).filter(personId=>personId!==selectedId));
  $("eventSaveBtn").textContent="保存修改";$("eventCancelEdit").hidden=false;
}

async function saveEvent(event) {
  event.preventDefault();
  if(!selectedId){alert("請先保存人物資料，再添加事件。");return;}
  const title=$("eventTitle").value.trim();
  if(!title){alert("請填寫事件名稱。");return;}
  const old=selectedEventId?events.find(item=>item.id===selectedEventId):null;
  const stamp=nowIso();
  const personIds=[...new Set([selectedId,...[...$("eventOtherPeople").selectedOptions].map(option=>option.value)])];
  const item={
    schemaVersion:1,id:old?.id||createId("E"),type:$("eventType").value,title,
    date:$("eventDate").value||null,datePrecision:$("eventDate").value?$("eventDatePrecision").value:"unknown",
    location:$("eventLocation").value.trim(),description:$("eventDescription").value.trim(),
    personIds,sourceIds:old?.sourceIds||[],createdAt:old?.createdAt||stamp,updatedAt:stamp
  };
  const nextEvents=[...events.filter(value=>value.id!==item.id),item];
  const checked=validateFamilyData({persons,relationships,events:nextEvents,media:mediaItems,sources:[]});
  if(!checked.valid){alert(checked.errors[0]);return;}
  try{
    await vault.save("family","events",item.id,1,item,old?selectedEventVersion:null);
    events=nextEvents;resetEventForm();renderEvents();message("人生事件已保存至 GitHub（明文）");
  }catch(error){alert("事件保存失敗："+error.message);}
}

async function deleteEvent(item) {
  if(mediaItems.some(media=>(media.eventIds||[]).includes(item.id))){
    alert("此事件仍被附件引用，請先解除附件關聯再刪除。");return;
  }
  if(!confirm("確定刪除事件「"+item.title+"」？"))return;
  try{
    await vault.delete("family","events",item.id);
    events=events.filter(event=>event.id!==item.id);
    if(selectedEventId===item.id)resetEventForm();
    renderEvents();message("事件已刪除");
  }catch(error){alert("事件刪除失敗："+error.message);}
}

function clearMediaUrls() {
  for (const url of mediaObjectUrls.values()) URL.revokeObjectURL(url);
  mediaObjectUrls.clear();
}

function mediaKind(file) {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return "document";
}

async function renderMedia() {
  const personId=selectedId;
  if(!personId)return;
  clearMediaUrls();
  const host=$("mediaList");
  host.replaceChildren();
  const records=mediaItems.filter(item=>(item.personIds||[]).includes(personId))
    .sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  if(!records.length){
    const empty=document.createElement("p");empty.className="muted";empty.textContent="此人物尚未添加照片或文件。";host.append(empty);return;
  }
  for(const item of records){
    if(selectedId!==personId)return;
    const card=document.createElement("article");card.className="mediaCard";
    const title=document.createElement("strong");title.textContent=item.caption||item.originalName||"未命名附件";
    const detail=document.createElement("small");
    detail.textContent=(item.kind==="photo"?"照片":item.kind==="document"?"文件":item.kind==="audio"?"音訊":item.kind==="video"?"影片":"附件")+" · "+Math.max(1,Math.round((item.sizeBytes||0)/1024))+" KB"+(item.encrypted?" · 已加密":" · 明文");
    card.append(title,detail);
    if(item.kind==="photo"&&(item.mimeType||"").startsWith("image/")&&!item.encrypted){
      try{
        const loaded=await vault.loadBytes("family","media-blobs",item.id);
        if(selectedId!==personId)return;
        if(loaded.bytes.length!==item.sizeBytes)throw new Error("附件大小不符");
        const url=URL.createObjectURL(new Blob([loaded.bytes],{type:item.mimeType}));
        mediaObjectUrls.set(item.id,url);
        const img=document.createElement("img");img.className="mediaPreview";img.src=url;img.alt=item.caption||item.originalName||"家庭照片";card.prepend(img);
      }catch(error){
        const failed=document.createElement("small");failed.className="error";failed.textContent="照片讀取或校驗失敗："+error.message;card.append(failed);
      }
    }else{
      const mark=document.createElement("div");mark.className="mediaFileMark";mark.textContent=item.kind==="document"?"📄":item.kind==="audio"?"♫":item.kind==="video"?"▶":"📎";card.prepend(mark);
    }
    const actions=document.createElement("div");actions.className="mediaActions";
    const download=document.createElement("button");download.type="button";download.className="secondary";download.textContent="下載";download.addEventListener("click",()=>downloadMedia(item));
    const remove=document.createElement("button");remove.type="button";remove.className="secondary";remove.textContent="刪除";remove.addEventListener("click",()=>deleteMedia(item));
    actions.append(download,remove);card.append(actions);host.append(card);
  }
}

async function addMedia(event) {
  event.preventDefault();
  if(!selectedId){alert("請先保存人物資料，再添加附件。");return;}
  const file=$("mediaFile").files?.[0];
  if(!file){alert("請先選擇照片或文件。");return;}
  if(file.size===0||file.size>25*1024*1024){alert("單個附件需大於 0 且不超過 25 MB。");return;}
  const personId=selectedId,id=createId("M"),createdAt=nowIso();
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());
    const objectId="family:media-blobs:"+id;
    const encrypted=$("mediaEncrypt").checked;
    let attachmentPassword=null;
    if(encrypted){
      attachmentPassword=prompt("為這個附件設定獨立加密密碼（至少 12 個字元）。請自行妥善保存，遺失後無法復原：");
      if(!attachmentPassword)return;
      const confirmPassword=prompt("請再次輸入附件加密密碼：");
      if(attachmentPassword!==confirmPassword)throw new Error("兩次輸入的密碼不一致。");
      await vault.saveEncryptedBytes("family","media-blobs",id,1,bytes,attachmentPassword,null);
      attachmentPassword="";
    }else{
      await vault.saveBytes("family","media-blobs",id,1,bytes,null);
    }
    const metadata={
      schemaVersion:1,id,kind:mediaKind(file),encryptedObjectId:objectId,
      originalName:file.name.slice(0,240),mimeType:file.type||"application/octet-stream",
      sizeBytes:file.size,personIds:[personId],eventIds:[],
      caption:$("mediaCaption").value.trim(),
      takenAt:null,encrypted,createdAt
    };
    const checked=validateFamilyData({persons,relationships,events,media:[...mediaItems,metadata],sources:[]});
    if(!checked.valid)throw new Error(checked.errors[0]);
    await vault.save("family","media",id,1,metadata,null);
    mediaItems.push(metadata);
    $("mediaForm").reset();
    await renderMedia();
    message(encrypted?"附件已加密後保存至 GitHub":"附件已以明文保存至 GitHub");
  }catch(error){
    await vault.delete("family","media-blobs",id).catch(()=>{});
    alert("附件保存失敗："+error.message);
  }
}

async function downloadMedia(item) {
  try{
    let attachmentPassword=null;
    if(item.encrypted){
      attachmentPassword=prompt("此附件已加密，請輸入保存時設定的附件密碼：");
      if(!attachmentPassword)return;
    }
    const loaded=await vault.loadBytes("family","media-blobs",item.id,attachmentPassword);
    attachmentPassword="";
    if(loaded.bytes.length!==item.sizeBytes)throw new Error("附件大小與索引不一致。");
    const blob=new Blob([loaded.bytes],{type:item.mimeType||"application/octet-stream"});
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download=String(item.originalName||"family-attachment").replace(/[\\/]/g,"_").replace(/[\\x00-\\x1f]/g,"_");
    anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }catch(error){alert("附件下載失敗："+error.message);}
}

async function deleteMedia(item) {
  if(!confirm("確定刪除此人物的附件？此操作會直接刪除 GitHub 私人倉庫中的附件。"))return;
  try{
    await vault.delete("family","media",item.id);
    await vault.delete("family","media-blobs",item.id);
    mediaItems=mediaItems.filter(x=>x.id!==item.id);
    const url=mediaObjectUrls.get(item.id);if(url)URL.revokeObjectURL(url);mediaObjectUrls.delete(item.id);
    await renderMedia();message("附件已刪除");
  }catch(error){alert("刪除附件失敗："+error.message);}
}

async function enterWorkspace() {
  if(!githubStorage?.connected) throw new Error("尚未連接私人資料倉庫。請返回 Hub 首頁重新進入。");
  try {
    $("gate").hidden=true;
    $("workspace").hidden=false;
    document.body.classList.add("ready");
    $("lockBtn").hidden=false;
    await loadAll();
    try { await loadMedicalRecords(); }
    catch(error) {
      $("healthState").textContent="舊版加密紀錄待遷移";
      $("healthUnlock").textContent="讀取舊版醫療資料";
      $("gateError").textContent="一般家庭資料已載入；舊版醫療資料暫未載入："+error.message;
    }
    await updateHealthState();
    document.body.classList.add("ready");
  } catch(error) {
    document.body.classList.remove("ready");
    $("gateError").textContent=error.message||"資料載入失敗";
    $("gate").hidden=false;
    $("workspace").hidden=true;
    throw error;
  }
}

async function start() {
  $("gateTitle").textContent="正在連接家庭資料";
  $("gateDesc").textContent="正在使用 Hub 首頁提供的共用密鑰連接私人倉庫；一般資料以明文保存，附件可逐件選擇加密。";
  $("gateSubmit").hidden=true;
  $("gateSubmit").disabled=true;
  $("passwordLabel").hidden=true;
  $("confirmWrap").hidden=true;
  $("restoreInput")?.closest(".restoreGate")?.setAttribute("hidden","");

  $("gateForm").addEventListener("submit",async event=>{
    event.preventDefault();
    try { await enterWorkspace(); }
    catch(error) { $("gateError").textContent=error.message||"資料載入失敗"; }
  });
  $("lockBtn").addEventListener("click",()=>{
    githubStorage?.clearToken();githubStorage=null;clearMediaUrls();persons=[];relationships=[];events=[];mediaItems=[];medicalRecords=[];medicalMediaItems=[];selectedId=null;selectedEventId=null;selectedEventVersion=null;selectedMedicalId=null;selectedMedicalVersion=null;selectedVersion=null;editing=false;
    $("personForm").reset();$("peopleList").replaceChildren();$("relationsList").replaceChildren();$("eventList").replaceChildren();$("mediaList").replaceChildren();$("eventForm").reset();$("medicalForm").reset();$("medicalList").replaceChildren();$("medicalSection").hidden=true;$("search").value="";$("mediaFile").value="";
    vault.lock();$("workspace").hidden=true;$("gate").hidden=false;$("lockBtn").hidden=true;
    $("gateTitle").textContent="家庭資料已鎖定";$("gateDesc").textContent="為保護私人資料，請返回 Hub 首頁重新輸入共用密鑰並進入家庭資料。";
    $("gateError").textContent="本頁不再要求重複輸入倉庫路徑或 Token。";
    $("githubStatus").textContent="已鎖定；請從 Hub 首頁重新進入。";
    $("cloudState").textContent="GitHub 尚未連接";
  });
  $("addPersonBtn").addEventListener("click",newPerson);$("emptyAdd").addEventListener("click",newPerson);
  $("cancelEdit").addEventListener("click",()=>selectedId?showPerson(selectedId):clearDetail());
  $("personForm").addEventListener("submit",savePerson);
  $("hasDeathDate").addEventListener("change",()=>{ $("deathDateWrap").hidden=!$("hasDeathDate").checked; if(!$("hasDeathDate").checked)$("deathDate").value=""; });
  $("deletePersonBtn").addEventListener("click",deleteSelectedPerson);$("search").addEventListener("input",renderPeople);
  $("addRelation").addEventListener("click",addRelation);$("mediaForm").addEventListener("submit",addMedia);
  $("eventForm").addEventListener("submit",saveEvent);$("eventCancelEdit").addEventListener("click",resetEventForm);
  $("eventDate").addEventListener("change",()=>{if($("eventDate").value&&$("eventDatePrecision").value==="unknown")$("eventDatePrecision").value="day";});
  $("medicalForm").addEventListener("submit",saveMedicalRecord);$("medicalCancelEdit").addEventListener("click",resetMedicalForm);
  $("medicalRecordType").addEventListener("change",toggleMedicalFields);$("medicalAttachmentEncrypt").addEventListener("change",toggleMedicalAttachmentEncryption);$("medicalFiles").addEventListener("change",toggleMedicalAttachmentEncryption);
  $("treeFit").addEventListener("click",()=>{treeZoom=1;renderTree();});
  const treeViewport=$("treeViewport");let treeDrag=null;
  treeViewport.addEventListener("pointerdown",event=>{
    if(event.button!==0)return;
    const node=event.target.closest(".treeNode");
    treeDrag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:treeViewport.scrollLeft,top:treeViewport.scrollTop,nodeId:node?.dataset.id||null,moved:false};
    try{treeViewport.setPointerCapture(event.pointerId);}catch{}
    event.preventDefault();
  });
  treeViewport.addEventListener("pointermove",event=>{
    if(!treeDrag||event.pointerId!==treeDrag.pointerId)return;
    const dx=event.clientX-treeDrag.x,dy=event.clientY-treeDrag.y;
    if(!treeDrag.moved&&Math.hypot(dx,dy)>4){
      treeDrag.moved=true;
      treeViewport.classList.add("dragging");
    }
    if(treeDrag.moved){
      treeViewport.scrollLeft=treeDrag.left-dx;
      treeViewport.scrollTop=treeDrag.top-dy;
    }
  });
  const stopTreeDrag=event=>{
    if(!treeDrag||event.pointerId!==treeDrag.pointerId)return;
    const finished=treeDrag;
    treeDrag=null;
    treeViewport.classList.remove("dragging");
    if(!finished.moved&&finished.nodeId)showPerson(finished.nodeId);
    try{if(treeViewport.hasPointerCapture(event.pointerId))treeViewport.releasePointerCapture(event.pointerId);}catch{}
  };
  treeViewport.addEventListener("pointerup",stopTreeDrag);
  treeViewport.addEventListener("pointercancel",event=>{treeDrag=null;treeViewport.classList.remove("dragging");});
  treeViewport.addEventListener("wheel",event=>{
    event.preventDefault();
    if(!persons.length)return;
    const center=selectedId||persons[0]?.id;
    const layout=buildTreeLayout(persons,relationships,center);
    const rect=treeViewport.getBoundingClientRect();
    const focusX=event.clientX-rect.left,focusY=event.clientY-rect.top;
    const before=treeZoom;
    const next=Math.max(0.55,Math.min(1.8,treeZoom*(event.deltaY<0?1.08:0.92)));
    if(next===before)return;
    const oldOffsetX=treeViewport.clientWidth+Math.max(0,(treeViewport.clientWidth-layout.width*before)/2);
    const oldOffsetY=treeViewport.clientHeight+Math.max(0,(treeViewport.clientHeight-layout.height*before)/2);
    const anchorX=(treeViewport.scrollLeft+focusX-oldOffsetX)/before;
    const anchorY=(treeViewport.scrollTop+focusY-oldOffsetY)/before;
    treeZoom=next;
    renderTree();
    const newOffsetX=treeViewport.clientWidth+Math.max(0,(treeViewport.clientWidth-layout.width*treeZoom)/2);
    const newOffsetY=treeViewport.clientHeight+Math.max(0,(treeViewport.clientHeight-layout.height*treeZoom)/2);
    treeViewport.scrollLeft=newOffsetX+anchorX*treeZoom-focusX;
    treeViewport.scrollTop=newOffsetY+anchorY*treeZoom-focusY;
  },{passive:false});
  $("healthUnlock").addEventListener("click",unlockHealth);
  $("connectGitHubBtn").addEventListener("click",connectGitHub);$("connectGitHubWorkspaceBtn").addEventListener("click",connectGitHub);
  $("downloadCloudBtn").addEventListener("click",downloadCloudBackup);$("githubUploadBtn").addEventListener("click",uploadCloudBackup);
  $("githubDownloadWorkspaceBtn").addEventListener("click",downloadCloudBackup);$("exportBackupBtn").addEventListener("click",downloadBackup);$("restoreBtn").addEventListener("click",restoreBackup);

  let handoffToken="";
  try {
    const marker="PD_MANAGER_TOKEN:";
    if(window.name.startsWith(marker)){handoffToken=window.name.slice(marker.length);window.name="";}
  } catch {}
  if(!handoffToken) {
    $("gateTitle").textContent="請從 Hub 首頁進入";
    $("gateDesc").textContent="家庭資料與黃金、設備共用同一個 GitHub 存取密鑰。請返回 Hub 首頁輸入密鑰，再點擊「家庭資料」即可直接進入。";
    $("gateError").textContent="目前沒有收到 Hub 傳入的存取密鑰。";
    return;
  }
  await connectGitHub({token:handoffToken,repoPath:"Khoohew/Personal-Data-Manager",autoEnter:true});
}

async function connectGitHub(eventOrOptions = {}) {
  const options=eventOrOptions && typeof eventOrOptions==="object" && "token" in eventOrOptions ? eventOrOptions : {};
  const fromWorkspace=eventOrOptions?.currentTarget?.id==="connectGitHubWorkspaceBtn";
  const token=String(options.token||((fromWorkspace?$("githubTokenWorkspace").value:$("githubToken").value).trim()
    ||(fromWorkspace?$("githubToken").value:$("githubTokenWorkspace").value).trim()));
  const repoPath=String(options.repoPath||((fromWorkspace?$("githubRepoWorkspace").value:$("githubRepo").value).trim()
    ||(fromWorkspace?$("githubRepo").value:$("githubRepoWorkspace").value).trim()||"Khoohew/Personal-Data-Manager"));
  try {
    if(!token)throw new Error("沒有收到 Hub 首頁提供的共用存取密鑰，請返回 Hub 首頁重新進入。");
    const match=/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repoPath);
    if(!match)throw new Error("請輸入私人 GitHub 倉庫路徑，格式為 owner/repository。");
    const service=new GitHubReleaseStorage({owner:match[1],repo:match[2]});
    service.setToken(token);
    await service.connect();
    githubStorage=service;
    vault.cache?.close?.();
    vault.cache=new GitHubPlainContentsCache(service);
    try{localStorage.setItem("familyVaultRepo",repoPath);}catch{}
    $("githubRepo").value=repoPath;$("githubRepoWorkspace").value=repoPath;
    $("githubToken").value="";$("githubTokenWorkspace").value="";
    const state="已連接私人倉庫；一般資料明文保存，附件可逐件加密。";
    $("githubStatus").textContent=state;
    $("githubWorkspaceStatus").textContent="資料直接讀寫 GitHub 私人倉庫；新資料以明文 JSON 保存。";
    $("cloudState").textContent="GitHub 私人倉庫已連接";
    $("storageNotice").textContent="雲端直存模式：人物、關係、事件及醫療文字以明文 JSON 寫入 GitHub 私人倉庫；附件可逐件選擇加密。";
    $("gateTitle").textContent="已連接家庭資料私人倉庫";
    $("gateDesc").textContent="一般家庭資料將以明文保存；勾選加密的附件會在本機加密後上傳。";
    $("passwordLabel").hidden=true;
    $("confirmWrap").hidden=true;
    $("gateSubmit").textContent="進入家庭資料";
    $("gateSubmit").disabled=false;
    $("downloadCloudBtn").disabled=true;
    $("githubUploadBtn").disabled=true;
    $("githubDownloadWorkspaceBtn").disabled=true;
    if(options.autoEnter) await enterWorkspace();
  } catch(error) {
    githubStorage?.clearToken();githubStorage=null;
    $("githubToken").value="";$("githubTokenWorkspace").value="";
    $("githubStatus").textContent="連接失敗："+error.message;
    $("githubWorkspaceStatus").textContent="連接失敗："+error.message;
    $("cloudState").textContent="GitHub 尚未連接";
    $("gateTitle").textContent="家庭資料連接失敗";
    $("gateDesc").textContent="請確認 Hub 首頁輸入的共用密鑰有 Personal-Data-Manager 私人倉庫的 Contents 讀寫權限，再返回首頁重試。";
    $("gateError").textContent=error.message||"GitHub 連接失敗";
    $("downloadCloudBtn").disabled=true;
    $("githubUploadBtn").disabled=true;
    $("githubDownloadWorkspaceBtn").disabled=true;
  }
}

async function uploadCloudBackup() {
  if(!githubStorage?.connected){alert("請先在解鎖頁連接 GitHub 私人倉庫。");return;}
  try {
    const includeMedical=$("includeMedical").checked;
    if(includeMedical && !(await vault.status("medical")).unlocked) {
      alert("請先解鎖醫療保險庫，再上傳包含醫療資料的備份。");return;
    }
    const blob=await exportEncryptedBackup(vault.cache,{includeMedical,sealManifest:manifest=>vault.sealBackupManifest(manifest)});
    const result=await githubStorage.uploadBackup(blob);
    const size=(result.size/1024/1024).toFixed(2)+" MB";
    const state="雲端備份完成："+result.name+"（"+size+"）；保留 "+result.retained+" 份最近備份。";
    $("githubWorkspaceStatus").textContent=state;
    $("githubStatus").textContent=state;
    $("storageNotice").textContent="最新加密備份已上傳至 GitHub。之後新增或修改的資料仍需再次手動上傳。";
    $("downloadCloudBtn").disabled=false;
    $("githubDownloadWorkspaceBtn").disabled=false;
    if(result.cleanupErrors.length) alert("新備份已上傳，但部分舊備份未能清理：\n"+result.cleanupErrors.join("\n"));
    else alert("加密備份已上傳至 GitHub 私人倉庫。");
  } catch(error) {
    $("githubWorkspaceStatus").textContent="雲端備份失敗："+error.message;
    alert("GitHub 備份失敗："+error.message);
  }
}

async function downloadCloudBackup() {
  if(!githubStorage?.connected){alert("請先連接 GitHub 私人倉庫。");return;}
  try {
    const remote=await githubStorage.downloadLatest();
    const inspected=await inspectEncryptedBackup(remote.blob);
    const medical=inspected.preview.scopes.includes("medical")?"，包含獨立醫療保險庫":"";
    const ok=confirm("雲端備份："+remote.name+"\n備份日期："+inspected.preview.createdAt+"\n加密物件："+inspected.preview.objectCount+" 筆"+medical+"\n\n還原前會要求輸入家庭保險庫密碼驗證清單。是否繼續？");
    if(!ok)return;
    let backupPassword=prompt("輸入此備份所屬的家庭保險庫密碼：");
    if(!backupPassword)return;
    const plan=await verifyEncryptedBackup(inspected,backupPassword);
    backupPassword="";
    const result=await applyEncryptedBackup(vault.cache,plan);
    if(result.conflicts.length) alert("已新增 "+result.restored+" 筆資料；另有 "+result.conflicts.length+" 筆保留未覆蓋。");
    else alert("雲端備份還原完成：新增 "+result.restored+" 筆。");
    location.reload();
  } catch(error) {
    $("githubStatus").textContent="下載／還原失敗："+error.message;
    alert("GitHub 備份還原失敗："+error.message);
  }
}

async function downloadBackup() {
  try {
    const includeMedical=$("includeMedical").checked;
    if(includeMedical && !(await vault.status("medical")).unlocked) {
      alert("請先解鎖醫療保險庫，再匯出包含醫療資料的備份。");
      return;
    }
    const blob=await exportEncryptedBackup(vault.cache,{includeMedical,sealManifest:manifest=>vault.sealBackupManifest(manifest)});
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
    const inspected=await inspectEncryptedBackup(file);
    const health=inspected.preview.scopes.includes("medical")?"，包含獨立醫療保險庫":"";
    const ok=confirm("備份日期："+inspected.preview.createdAt+"\n加密物件："+inspected.preview.objectCount+" 筆"+health+"\n\n還原前會要求輸入家庭保險庫密碼驗證清單。是否繼續？");
    if(!ok)return;
    let backupPassword=prompt("輸入此備份所屬的家庭保險庫密碼：");
    if(!backupPassword)return;
    const plan=await verifyEncryptedBackup(inspected,backupPassword);
    backupPassword="";
    const result=await applyEncryptedBackup(vault.cache,plan);
    alert("還原完成：新增 "+result.restored+" 筆；衝突／保留未覆蓋 "+result.conflicts.length+" 筆。\n重新載入後，使用備份原本的密碼解鎖。");
    location.reload();
  } catch(error) { alert("備份檢查／還原失敗："+error.message); }
  finally { $("restoreInput").value=""; }
}

const MEDICAL_LABELS={allergy:"過敏",condition:"疾病／健康狀況",medication:"用藥",surgery:"手術",vaccination:"疫苗",test:"檢查／檢驗",visit:"門診",hospitalization:"住院",other:"其他"};

async function loadMedicalRecords() {
  medicalRecords=[];
  medicalMediaItems=[];
  const items=await vault.cache.list("health");
  for(const item of items){
    if(!item.objectId.startsWith("medical:health:"))continue;
    const id=item.objectId.slice("medical:health:".length);
    const loaded=await vault.load("medical","health",id);
    if(loaded)medicalRecords.push({id,version:loaded.version,...loaded.value});
  }
  const attachmentItems=await vault.cache.list("health-media");
  for(const item of attachmentItems){
    if(!item.objectId.startsWith("medical:health-media:"))continue;
    const id=item.objectId.slice("medical:health-media:".length);
    const loaded=await vault.load("medical","health-media",id);
    if(loaded)medicalMediaItems.push({id,version:loaded.version,...loaded.value});
  }
}

function resetMedicalForm() {
  selectedMedicalId=null;selectedMedicalVersion=null;
  const form=$("medicalForm");if(!form)return;
  form.reset();$("medicalRecordType").value="condition";
  $("medicalMedicationFields").hidden=true;$("medicalAllergyFields").hidden=true;
  $("medicalAttachmentPasswordFields").hidden=true;
  $("medicalAttachmentPassword").value="";$("medicalAttachmentPasswordConfirm").value="";
  $("medicalAttachmentPassword").required=false;$("medicalAttachmentPasswordConfirm").required=false;
  $("medicalFormAttachmentList").hidden=true;$("medicalFormAttachmentList").textContent="";
  $("medicalSaveBtn").textContent="保存醫療紀錄";$("medicalCancelEdit").hidden=true;
}

function toggleMedicalFields() {
  const type=$("medicalRecordType").value;
  $("medicalMedicationFields").hidden=type!=="medication";
  $("medicalAllergyFields").hidden=type!=="allergy";
}
function toggleMedicalAttachmentEncryption() {
  const enabled=$("medicalAttachmentEncrypt").checked;
  const needsPassword=enabled&&($("medicalFiles").files?.length||0)>0;
  $("medicalAttachmentPasswordFields").hidden=!enabled;
  $("medicalAttachmentPassword").required=needsPassword;
  $("medicalAttachmentPasswordConfirm").required=needsPassword;
}
function renderMedicalFormAttachments(record) {
  const host=$("medicalFormAttachmentList");
  const attachments=medicalMediaItems.filter(file=>(record.sourceMediaIds||[]).includes(file.id));
  host.hidden=!attachments.length;
  host.textContent=attachments.length
    ? "此筆紀錄已保存 "+attachments.length+" 件原件；新上傳的檔案會附加在原件清單，不會覆蓋舊檔。"
    : "";
}

function medicalDateLabel(value) { return value||"日期未記錄"; }
function medicalFileName(file,index) {
  const extension=String(file.name||"").match(/\.[a-zA-Z0-9]{1,8}$/)?.[0]||"";
  return "加密原件-"+index+extension;
}
function safeDownloadName(value) {
  return String(value||"medical-original").replace(/[\\/]/g,"_").replace(/[\x00-\x1f]/g,"_");
}

async function downloadMedicalAttachment(item) {
  let password=null;
  try{
    if(item.encrypted){
      password=prompt("此醫療原件已加密，請輸入上傳時設定的原件密碼：");
      if(!password)return;
    }
    const loaded=await vault.loadBytes("medical","health-blobs",item.id,password);
    password="";
    if(loaded.bytes.length!==item.sizeBytes)throw new Error("原件大小與索引不一致。");
    const blob=new Blob([loaded.bytes],{type:item.mimeType||"application/octet-stream"});
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download=safeDownloadName(item.originalName||"medical-original");
    anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }catch(error){
    password="";
    alert("醫療原件讀取／下載失敗："+error.message);
  }
}

async function deleteMedicalAttachment(item,record) {
  if(!confirm("確定刪除此件醫療原件？此操作會從 GitHub 私人倉庫刪除檔案。"))return;
  try{
    const nextPayload={...record,sourceMediaIds:(record.sourceMediaIds||[]).filter(id=>id!==item.id)};
    const result=await vault.save("medical","health",record.id,1,nextPayload,record.version);
    medicalRecords=medicalRecords.map(value=>value.id===record.id?{...nextPayload,id:record.id,version:result.version}:value);
    await vault.delete("medical","health-media",item.id);
    await vault.delete("medical","health-blobs",item.id);
    medicalMediaItems=medicalMediaItems.filter(value=>value.id!==item.id);
    renderMedicalRecords();
    if(selectedMedicalId===record.id)renderMedicalFormAttachments(nextPayload);
  }catch(error){alert("刪除醫療原件失敗："+error.message);}
}

function renderMedicalRecords() {
  const host=$("medicalList");host.replaceChildren();
  if(!selectedId)return;
  const records=medicalRecords.filter(item=>item.personRef===selectedId)
    .sort((a,b)=>String(b.recordDate||"").localeCompare(String(a.recordDate||"")));
  if(!records.length){
    const empty=document.createElement("p");empty.className="muted";empty.textContent="此人物尚無醫療紀錄。";host.append(empty);return;
  }
  for(const item of records){
    const card=document.createElement("article");card.className="medicalCard";
    const head=document.createElement("div");head.className="eventHead";
    const title=document.createElement("strong");title.textContent=item.summary;
    const type=document.createElement("span");type.className="eventType";type.textContent=MEDICAL_LABELS[item.recordType]||"其他";
    head.append(title,type);card.append(head);
    const date=document.createElement("small");date.textContent=medicalDateLabel(item.recordDate)+(item.endDate?" 至 "+item.endDate:"");card.append(date);
    if(item.details){const details=document.createElement("p");details.textContent=item.details;card.append(details);}
    if(item.recordType==="medication"&&item.medication){
      const med=document.createElement("small");med.textContent=[item.medication.name,item.medication.dose,item.medication.frequency,item.medication.status==="active"?"使用中":item.medication.status==="stopped"?"已停用":"狀態不詳"].filter(Boolean).join(" · ");card.append(med);
    }
    if(item.recordType==="allergy"&&item.allergy){
      const allergy=document.createElement("small");allergy.textContent=[item.allergy.substance,item.allergy.reaction,item.allergy.severity==="severe"?"嚴重":item.allergy.severity==="moderate"?"中等":item.allergy.severity==="mild"?"輕微":"程度不詳"].filter(Boolean).join(" · ");card.append(allergy);
    }
    if(item.provider||item.facility){const source=document.createElement("small");source.textContent=[item.provider,item.facility].filter(Boolean).join(" · ");card.append(source);}
    const verified=document.createElement("small");verified.textContent=item.verifiedByUser?"已由使用者核實":"尚未核實";card.append(verified);
    const attachments=medicalMediaItems.filter(file=>(item.sourceMediaIds||[]).includes(file.id));
    if(attachments.length){
      const attachmentList=document.createElement("div");attachmentList.className="medicalOriginalList";
      for(const file of attachments){
        const row=document.createElement("div");row.className="medicalOriginalRow";
        const name=document.createElement("div");name.className="medicalOriginalName";
        name.textContent=file.originalName||"醫療原件";
        const meta=document.createElement("small");meta.className="medicalOriginalMeta";
        meta.textContent=(file.mimeType||"檔案")+" · "+Math.max(1,Math.round((file.sizeBytes||0)/1024))+" KB · "+(file.encrypted?"已加密":"明文");
        name.append(meta);
        const buttons=document.createElement("div");buttons.className="medicalOriginalActions";
        const download=document.createElement("button");download.type="button";download.className="secondary";download.textContent="下載原件";download.addEventListener("click",()=>downloadMedicalAttachment(file));
        const remove=document.createElement("button");remove.type="button";remove.className="secondary";remove.textContent="刪除原件";remove.addEventListener("click",()=>deleteMedicalAttachment(file,item));
        buttons.append(download,remove);row.append(name,buttons);attachmentList.append(row);
      }
      card.append(attachmentList);
    }
    const actions=document.createElement("div");actions.className="eventActions";
    const edit=document.createElement("button");edit.type="button";edit.className="secondary";edit.textContent="編輯";edit.addEventListener("click",()=>editMedicalRecord(item.id));
    const remove=document.createElement("button");remove.type="button";remove.className="secondary";remove.textContent="刪除";remove.addEventListener("click",()=>deleteMedicalRecord(item));
    actions.append(edit,remove);card.append(actions);host.append(card);
  }
}

function editMedicalRecord(id) {
  const item=medicalRecords.find(value=>value.id===id);if(!item)return;
  selectedMedicalId=id;selectedMedicalVersion=item.version;
  $("medicalRecordType").value=item.recordType;$("medicalRecordDate").value=item.recordDate||"";
  $("medicalEndDate").value=item.endDate||"";$("medicalSummary").value=item.summary||"";
  $("medicalDetails").value=item.details||"";$("medicalProvider").value=item.provider||"";
  $("medicalFacility").value=item.facility||"";$("medicalVerified").checked=!!item.verifiedByUser;
  $("medicalNotes").value=item.notes||"";
  $("medicalMedicationName").value=item.medication?.name||"";
  $("medicalMedicationDose").value=item.medication?.dose||"";
  $("medicalMedicationRoute").value=item.medication?.route||"";
  $("medicalMedicationFrequency").value=item.medication?.frequency||"";
  $("medicalMedicationStart").value=item.medication?.startDate||"";
  $("medicalMedicationEnd").value=item.medication?.endDate||"";
  $("medicalMedicationStatus").value=item.medication?.status||"unknown";
  $("medicalAllergySubstance").value=item.allergy?.substance||"";
  $("medicalAllergyReaction").value=item.allergy?.reaction||"";
  $("medicalAllergySeverity").value=item.allergy?.severity||"unknown";
  $("medicalAttachmentEncrypt").checked=false;
  toggleMedicalAttachmentEncryption();
  renderMedicalFormAttachments(item);
  toggleMedicalFields();$("medicalSaveBtn").textContent="保存修改";$("medicalCancelEdit").hidden=false;
}

async function saveMedicalRecord(event) {
  event.preventDefault();
  if(!selectedId){alert("請先選擇一位已保存的人物。");return;}
  const type=$("medicalRecordType").value;
  const files=Array.from($("medicalFiles").files||[]);
  if(files.some(file=>file.size===0||file.size>25*1024*1024)){
    alert("每個醫療原件需大於 0 且不超過 25 MB。");return;
  }
  const encrypted=$("medicalAttachmentEncrypt").checked&&files.length>0;
  const attachmentPassword=encrypted?$("medicalAttachmentPassword").value:"";
  const confirmPassword=encrypted?$("medicalAttachmentPasswordConfirm").value:"";
  if(encrypted&&(attachmentPassword.length<12||attachmentPassword!==confirmPassword)){
    alert("原件加密密碼至少 12 個字元，而且兩次輸入必須一致。");return;
  }
  const old=selectedMedicalId?medicalRecords.find(item=>item.id===selectedMedicalId):null;
  const id=old?.id||createId("H");
  const payload={
    personRef:selectedId,recordType:type,recordDate:$("medicalRecordDate").value||null,
    endDate:$("medicalEndDate").value||null,summary:$("medicalSummary").value.trim(),
    details:$("medicalDetails").value.trim(),provider:$("medicalProvider").value.trim(),
    facility:$("medicalFacility").value.trim(),sourceMediaIds:[...(old?.sourceMediaIds||[])],
    verifiedByUser:$("medicalVerified").checked,notes:$("medicalNotes").value.trim()
  };
  if(type==="medication")payload.medication={
    name:$("medicalMedicationName").value.trim(),dose:$("medicalMedicationDose").value.trim(),
    route:$("medicalMedicationRoute").value.trim(),frequency:$("medicalMedicationFrequency").value.trim(),
    startDate:$("medicalMedicationStart").value||null,endDate:$("medicalMedicationEnd").value||null,
    status:$("medicalMedicationStatus").value
  };
  if(type==="allergy")payload.allergy={
    substance:$("medicalAllergySubstance").value.trim(),reaction:$("medicalAllergyReaction").value.trim(),
    severity:$("medicalAllergySeverity").value
  };
  const checked=validateMedicalRecord(payload,new Set(persons.map(person=>person.id)));
  if(!checked.valid){alert(checked.errors[0]);return;}
  const createdIds=[];
  try{
    for(let index=0;index<files.length;index++){
      const file=files[index],attachmentId=createId("HA");
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(encrypted)await vault.saveEncryptedBytes("medical","health-blobs",attachmentId,1,bytes,attachmentPassword,null);
      else await vault.saveBytes("medical","health-blobs",attachmentId,1,bytes,null);
      createdIds.push(attachmentId);
      const metadata={
        schemaVersion:1,id:attachmentId,healthRecordId:id,personRef:selectedId,
        originalName:encrypted?medicalFileName(file,index+1):file.name.slice(0,240),
        mimeType:file.type||"application/octet-stream",sizeBytes:file.size,
        encrypted,createdAt:nowIso()
      };
      await vault.save("medical","health-media",attachmentId,1,metadata,null);
      payload.sourceMediaIds.push(attachmentId);
      medicalMediaItems.push({...metadata,version:1});
    }
    const result=await vault.save("medical","health",id,1,payload,old?selectedMedicalVersion:null);
    medicalRecords=medicalRecords.filter(item=>item.id!==id);
    medicalRecords.push({id,version:result.version,...payload});
    resetMedicalForm();renderMedicalRecords();
    alert("醫療紀錄已保存。文字資料為明文；本次原件："+(files.length?(encrypted?"已加密":"明文"):"未新增附件")+"。");
  }catch(error){
    for(const attachmentId of createdIds){
      await vault.delete("medical","health-media",attachmentId).catch(()=>{});
      await vault.delete("medical","health-blobs",attachmentId).catch(()=>{});
      medicalMediaItems=medicalMediaItems.filter(file=>file.id!==attachmentId);
    }
    alert("醫療紀錄／原件保存失敗："+error.message);
  }finally{
    $("medicalAttachmentPassword").value="";
    $("medicalAttachmentPasswordConfirm").value="";
  }
}

async function deleteMedicalRecord(item) {
  if(!confirm("確定刪除此筆醫療紀錄及其關聯的所有原件？此操作會直接刪除 GitHub 私人倉庫中的資料。"))return;
  try{
    await vault.delete("medical","health",item.id,item.version);
    const attachments=medicalMediaItems.filter(file=>(item.sourceMediaIds||[]).includes(file.id));
    for(const file of attachments){
      await vault.delete("medical","health-media",file.id);
      await vault.delete("medical","health-blobs",file.id);
    }
    medicalRecords=medicalRecords.filter(record=>record.id!==item.id);
    medicalMediaItems=medicalMediaItems.filter(file=>!(item.sourceMediaIds||[]).includes(file.id));
    if(selectedMedicalId===item.id)resetMedicalForm();
    renderMedicalRecords();
  }catch(error){alert("醫療紀錄刪除失敗："+error.message);}
}

async function updateHealthState() {
  $("healthState").textContent="文字明文／原件可選加密";
  $("healthUnlock").textContent="重新載入醫療紀錄";
  $("healthState").dataset.scope="medical";
  $("medicalSection").hidden=!selectedId;
}
async function unlockHealth() {
  try {
    await loadMedicalRecords();
    await updateHealthState();
    if(selectedId)renderMedicalRecords();
  } catch(error) {
    alert("醫療資料讀取失敗："+error.message+"。若這是舊版加密紀錄，需要先完成舊資料解鎖與遷移。");
  }
}

start().catch(error=>{$("gateError").textContent="啟動失敗："+error.message;});
