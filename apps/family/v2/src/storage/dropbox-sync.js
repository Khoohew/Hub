function encodeEnvelope(envelope) {
  const text=JSON.stringify(envelope,(_key,value)=>{
    if(value instanceof Uint8Array){
      let binary="";for(let i=0;i<value.length;i+=0x8000)binary+=String.fromCharCode(...value.subarray(i,i+0x8000));
      return {$familyVaultBytes:btoa(binary)};
    }
    return value;
  });
  return new TextEncoder().encode(text);
}
function decodeEnvelope(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes),(_key,value)=>{
    if(value&&typeof value==="object"&&typeof value.$familyVaultBytes==="string"){
      const binary=atob(value.$familyVaultBytes),out=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
      return out;
    }
    return value;
  });
}
function assertObjectMatches(objectId,envelope,vaultId) {
  const [scope,collection,recordId]=objectId.split(":");
  if(!scope||!collection||!recordId||envelope.collection!==collection||envelope.recordId!==recordId||envelope.vaultId!==vaultId) {
    throw new Error("雲端物件識別資訊與加密封包不一致："+objectId);
  }
}

/**
 * Two-way sync for one unlocked/authorized vault scope.
 * The adapter stores ciphertext only. Conflicts are reported, never silently overwritten.
 */
export async function syncDropboxVault(cache,adapter,scope) {
  if(!["family","medical"].includes(scope))throw new Error("未知保險庫範圍。");
  await adapter.ensureRoot?.();
  const descriptorKey=scope==="family"?"vault:family:descriptor":"vault:medical:descriptor";
  const descriptor=await cache.getMeta(descriptorKey);
  if(!descriptor)throw new Error("本機尚未建立對應保險庫，不能同步。");
  const remoteItems=[];
  let cursor=null;
  do {
    const page=await adapter.list("",cursor);
    remoteItems.push(...page.items.filter(x=>x.objectId?.startsWith(scope+":")&&!x.objectId.split(":")[1]?.includes("connections")));
    cursor=page.nextCursor;
  } while(cursor);
  const remoteById=new Map(remoteItems.map(x=>[x.objectId,x]));
  const localItems=(await cache.list()).filter(x=>x.objectId.startsWith(scope+":")&&x.objectId.split(":")[1]!=="connections");
  const localById=new Map(localItems.map(x=>[x.objectId,x]));
  const summary={uploaded:0,downloaded:0,unchanged:0,conflicts:[]};

  for(const local of localItems) {
    const remote=remoteById.get(local.objectId);
    if(!remote) {
      if(local.remoteVersion==null) {
        const stored=await cache.get(local.objectId);
        const result=await adapter.put(local.objectId,encodeEnvelope(stored.envelope),null);
        await cache.markSynced(local.objectId,local.version,result.version);
        summary.uploaded++;
      } else {
        summary.conflicts.push({objectId:local.objectId,reason:"雲端檔案已不存在；為避免誤刪或覆蓋，未自動重新上傳。"});
      }
      continue;
    }

    if(local.remoteVersion===remote.version) {
      if(local.syncedLocalVersion===local.version) {
        summary.unchanged++;
      } else {
        const stored=await cache.get(local.objectId);
        const result=await adapter.put(local.objectId,encodeEnvelope(stored.envelope),remote.version);
        await cache.markSynced(local.objectId,local.version,result.version);
        summary.uploaded++;
      }
      continue;
    }

    if(local.remoteVersion==null) {
      summary.conflicts.push({objectId:local.objectId,reason:"本機和雲端同時存在尚未建立同步基準的同 ID 物件。"});
      continue;
    }

    if(local.syncedLocalVersion===local.version) {
      const remoteData=await adapter.get(local.objectId);
      const envelope=decodeEnvelope(remoteData.bytes);
      assertObjectMatches(local.objectId,envelope,descriptor.vaultId);
      const collection=local.objectId.split(":")[1];
      await cache.put(local.objectId,collection,envelope,local.version);
      const refreshed=await cache.get(local.objectId);
      await cache.markSynced(local.objectId,refreshed.version,remoteData.version);
      summary.downloaded++;
    } else {
      summary.conflicts.push({objectId:local.objectId,reason:"本機與雲端都在上次同步後有修改，兩份資料均保留，需人工合併。"});
    }
  }

  for(const remote of remoteItems) {
    if(localById.has(remote.objectId))continue;
    const remoteData=await adapter.get(remote.objectId);
    const envelope=decodeEnvelope(remoteData.bytes);
    assertObjectMatches(remote.objectId,envelope,descriptor.vaultId);
    const collection=remote.objectId.split(":")[1];
    await cache.put(remote.objectId,collection,envelope,"absent");
    const stored=await cache.get(remote.objectId);
    await cache.markSynced(remote.objectId,stored.version,remoteData.version);
    summary.downloaded++;
  }
  return summary;
}
