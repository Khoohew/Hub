const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1); table[n]=c>>>0; }
  return table;
})();
function crc32(bytes) { let c=0xffffffff; for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
function u16(view,offset,value){view.setUint16(offset,value,true)}
function u32(view,offset,value){view.setUint32(offset,value>>>0,true)}
function read16(view,offset){return view.getUint16(offset,true)}
function read32(view,offset){return view.getUint32(offset,true)}
function concat(chunks) {
  const size=chunks.reduce((n,x)=>n+x.length,0),out=new Uint8Array(size);
  let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
}

/** Creates a standard ZIP archive using STORE (no compression), with UTF-8 names. */
export function createStoredZip(entries) {
  if(!Array.isArray(entries)||entries.length>50000)throw new Error("備份檔案數量不正確。");
  const names=new Set(),locals=[],centrals=[];let offset=0;
  for(const entry of entries){
    const name=String(entry.name||"");
    if(!name||name.startsWith("/")||name.split("/").includes("..")||names.has(name))throw new Error("ZIP 檔名不安全或重複。");
    names.add(name);
    const nameBytes=encoder.encode(name),data=entry.data instanceof Uint8Array?entry.data:new Uint8Array(entry.data);
    if(nameBytes.length>65535||data.length>0xffffffff)throw new Error("單一備份檔案超出 ZIP 限制。");
    const crc=crc32(data),local=new Uint8Array(30+nameBytes.length),lv=new DataView(local.buffer);
    u32(lv,0,LOCAL);u16(lv,4,20);u16(lv,6,0x0800);u16(lv,8,0);
    u16(lv,10,0);u16(lv,12,0);u32(lv,14,crc);u32(lv,18,data.length);u32(lv,22,data.length);
    u16(lv,26,nameBytes.length);u16(lv,28,0);local.set(nameBytes,30);
    locals.push(local,data);
    const central=new Uint8Array(46+nameBytes.length),cv=new DataView(central.buffer);
    u32(cv,0,CENTRAL);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x0800);u16(cv,10,0);
    u16(cv,12,0);u16(cv,14,0);u32(cv,16,crc);u32(cv,20,data.length);u32(cv,24,data.length);
    u16(cv,28,nameBytes.length);u16(cv,30,0);u16(cv,32,0);u16(cv,34,0);u16(cv,36,0);
    u32(cv,38,0);u32(cv,42,offset);central.set(nameBytes,46);centrals.push(central);
    offset+=local.length+data.length;
  }
  const centralBytes=concat(centrals),localBytes=concat(locals);
  const end=new Uint8Array(22),ev=new DataView(end.buffer);
  u32(ev,0,END);u16(ev,4,0);u16(ev,6,0);u16(ev,8,entries.length);u16(ev,10,entries.length);
  u32(ev,12,centralBytes.length);u32(ev,16,localBytes.length);u16(ev,20,0);
  return concat([localBytes,centralBytes,end]);
}

/** Reads STORE ZIP files produced above; rejects compressed, encrypted or unsafe entries. */
export function readStoredZip(bytes) {
  const input=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),view=new DataView(input.buffer,input.byteOffset,input.byteLength);
  const entries=new Map();let offset=0;
  while(offset+4<=input.length&&read32(view,offset)===LOCAL){
    if(offset+30>input.length)throw new Error("ZIP 本機檔案標頭不完整。");
    const flags=read16(view,offset+6),method=read16(view,offset+8),crc=read32(view,offset+14);
    const compressed=read32(view,offset+18),uncompressed=read32(view,offset+22);
    const nameLength=read16(view,offset+26),extraLength=read16(view,offset+28);
    if((flags&1)!==0||method!==0||compressed!==uncompressed)throw new Error("不支援加密或壓縮 ZIP 項目。");
    const nameStart=offset+30,nameEnd=nameStart+nameLength,dataStart=nameEnd+extraLength,dataEnd=dataStart+compressed;
    if(dataEnd>input.length)throw new Error("ZIP 檔案內容不完整。");
    const name=decoder.decode(input.subarray(nameStart,nameEnd));
    if(!name||name.startsWith("/")||name.split("/").includes("..")||entries.has(name))throw new Error("ZIP 包含不安全或重複路徑。");
    const data=input.slice(dataStart,dataEnd);
    if(crc32(data)!==crc)throw new Error("ZIP CRC 校驗失敗："+name);
    entries.set(name,data);offset=dataEnd;
  }
  if(!entries.size||offset>input.length)throw new Error("不是有效的家庭資料庫 ZIP 備份。");
  return entries;
}
