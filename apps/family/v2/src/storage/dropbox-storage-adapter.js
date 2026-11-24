import { StorageAdapter, StorageConflictError, StorageAuthorizationError } from "./storage-adapter.js";

const API_ROOT="https://api.dropboxapi.com/2";
const CONTENT_ROOT="https://content.dropboxapi.com/2";
const SAFE_SEGMENT=/^[a-z0-9-]+$/i;

export class DropboxStorageAdapter extends StorageAdapter {
  constructor({ tokenProvider, root="/family-vault-v2", fetchImpl=fetch }) {
    super();
    if(typeof tokenProvider!=="function")throw new Error("Dropbox adapter requires a tokenProvider.");
    this.tokenProvider=tokenProvider;
    this.root=root.replace(/\/$/,"");
    this.fetchImpl=fetchImpl;
  }

  objectPath(objectId) {
    const parts=String(objectId).split(":");
    if(parts.length!==3||parts.some(x=>!SAFE_SEGMENT.test(x)))throw new Error("Invalid opaque storage object ID.");
    return this.root+"/"+parts.join("--")+".bin";
  }

  async request(endpoint,{body,headers={},content=false}={}) {
    const token=await this.tokenProvider();
    const response=await this.fetchImpl((content?CONTENT_ROOT:API_ROOT)+endpoint,{
      method:"POST",
      headers:{Authorization:"Bearer "+token,...headers},
      body
    });
    if(response.status===401)throw new StorageAuthorizationError("Dropbox access token expired or revoked.");
    if(response.status===409)throw new StorageConflictError("Dropbox object conflict: "+await response.text());
    if(!response.ok)throw new Error("Dropbox API "+response.status+": "+(await response.text()).slice(0,500));
    return response;
  }

  async ensureRoot() {
    try {
      await this.request("/files/create_folder_v2",{
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({path:this.root,autorename:false})
      });
    } catch(error) {
      if(!(error instanceof StorageConflictError))throw error;
    }
  }

  async get(objectId) {
    const path=this.objectPath(objectId);
    const metaResponse=await this.request("/files/get_metadata",{
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({path})
    });
    const metadata=await metaResponse.json();
    const response=await this.request("/files/download",{
      content:true,
      headers:{"Dropbox-API-Arg":JSON.stringify({path})}
    });
    return {bytes:new Uint8Array(await response.arrayBuffer()),version:metadata.rev||null};
  }

  async put(objectId,bytes,expectedVersion=null) {
    const path=this.objectPath(objectId);
    const mode=expectedVersion===null?"add":{".tag":"update",update:expectedVersion};
    const arg={path,mode,autorename:false,mute:true,strict_conflict:true};
    const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    const response=await this.request("/files/upload",{
      content:true,
      headers:{"Content-Type":"application/octet-stream","Dropbox-API-Arg":JSON.stringify(arg)},
      body:data
    });
    const result=await response.json();
    return {version:result.rev,serverModified:result.server_modified||null};
  }

  async delete(_objectId,_expectedVersion=null) {
    // Dropbox delete_v2 has no atomic revision precondition. Use tombstone objects instead.
    throw new Error("Dropbox Adapter disables physical deletion; use a versioned tombstone to preserve recovery history.");
  }

  async list(_prefix="",cursor=null) {
    const endpoint=cursor?"/files/list_folder/continue":"/files/list_folder";
    const body=cursor?{cursor}:{path:this.root,recursive:true,include_deleted:false,include_non_downloadable_files:false};
    const response=await this.request(endpoint,{
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const result=await response.json();
    const prefix=this.root+"/";
    const items=(result.entries||[]).filter(x=>x[".tag"]==="file"&&x.path_display?.startsWith(prefix)).map(file=>{
      const relative=file.path_display.slice(prefix.length).replace(/\.bin$/,"");
      const parts=relative.split("--");
      return {objectId:parts.length===3?parts.join(":"):null,version:file.rev||null,size:file.size||0,updatedAt:file.server_modified||null};
    }).filter(x=>x.objectId);
    return {items,nextCursor:result.has_more?result.cursor:null};
  }
}
