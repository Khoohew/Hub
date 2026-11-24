const PREFIX = {
  person: "P-", relationship: "R-", event: "E-", media: "M-", source: "S-", health: "H-"
};
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isIsoDate = value => {
  if (value == null || value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
function requireId(record, kind, errors, label) {
  if (!record || typeof record.id !== "string" || !record.id.startsWith(PREFIX[kind])) {
    errors.push(label + "：ID 格式錯誤");
  }
}
function uniqueIds(items, label, errors) {
  const seen = new Set();
  for (const id of items || []) {
    if (seen.has(id)) errors.push(label + "：重複 ID " + id);
    seen.add(id);
  }
}

/**
 * Validates the relational integrity of a decrypted family vault before save,
 * sync, or restore. This intentionally validates relationships as the source
 * of truth instead of maintaining duplicated parent/child arrays on persons.
 */
export function validateFamilyData(data) {
  const errors = [];
  if (!isObject(data)) return { valid: false, errors: ["資料庫格式錯誤"] };
  const collections = ["persons", "relationships", "events", "media", "sources"];
  for (const key of collections) if (!Array.isArray(data[key])) errors.push(key + " 必須是陣列");
  if (errors.length) return { valid: false, errors };

  const maps = {};
  for (const [key, kind] of [["persons","person"],["relationships","relationship"],["events","event"],["media","media"],["sources","source"]]) {
    const map = new Map();
    for (const record of data[key]) {
      if (!isObject(record)) { errors.push(key + " 包含非物件資料"); continue; }
      requireId(record, kind, errors, key);
      if (map.has(record.id)) errors.push(key + "：ID 重複 " + record.id);
      map.set(record.id, record);
    }
    maps[key] = map;
  }

  const spousePairs = new Set();
  const parentPairs = new Set();
  const parentEdges = new Map();
  for (const rel of data.relationships) {
    if (!isObject(rel)) continue;
    if (!maps.persons.has(rel.fromPersonId)) errors.push("關係引用不存在的人物：" + rel.fromPersonId);
    if (!maps.persons.has(rel.toPersonId)) errors.push("關係引用不存在的人物：" + rel.toPersonId);
    if (rel.fromPersonId === rel.toPersonId) errors.push("人物不能與自己建立關係：" + rel.id);
    if (rel.type === "spouse_of") {
      const pair = [rel.fromPersonId, rel.toPersonId].sort().join("|");
      if (spousePairs.has(pair)) errors.push("配偶關係重複：" + pair);
      spousePairs.add(pair);
    }
    if (rel.type === "parent_of" || rel.type === "adoptive_parent_of") {
      const pair = rel.type + "|" + rel.fromPersonId + "|" + rel.toPersonId;
      if (parentPairs.has(pair)) errors.push("父母子女關係重複：" + pair);
      parentPairs.add(pair);
      if (!parentEdges.has(rel.fromPersonId)) parentEdges.set(rel.fromPersonId, []);
      parentEdges.get(rel.fromPersonId).push(rel.toPersonId);
    }
  }

  // Detect cycles in biological parentage; a cycle would make ancestry invalid.
  const visiting = new Set(), visited = new Set();
  function visit(personId) {
    if (visiting.has(personId)) { errors.push("父母子女關係形成循環，涉及人物：" + personId); return; }
    if (visited.has(personId)) return;
    visiting.add(personId);
    for (const childId of parentEdges.get(personId) || []) visit(childId);
    visiting.delete(personId);
    visited.add(personId);
  }
  for (const id of maps.persons.keys()) visit(id);

  for (const event of data.events) {
    if (!isObject(event)) continue;
    if (!Array.isArray(event.personIds) || event.personIds.length === 0) errors.push("事件至少要關聯一位人物：" + event.id);
    for (const id of event.personIds || []) if (!maps.persons.has(id)) errors.push("事件引用不存在的人物：" + id);
    if (!isIsoDate(event.date)) errors.push("事件日期格式錯誤：" + event.id);
  }
  for (const media of data.media) {
    if (!isObject(media)) continue;
    for (const id of media.personIds || []) if (!maps.persons.has(id)) errors.push("媒體引用不存在的人物：" + id);
    for (const id of media.eventIds || []) if (!maps.events.has(id)) errors.push("媒體引用不存在的事件：" + id);
  }
  for (const source of data.sources) {
    if (!isObject(source)) continue;
    for (const id of source.mediaIds || []) if (!maps.media.has(id)) errors.push("來源引用不存在的媒體：" + id);
  }
  return { valid: errors.length === 0, errors };
}
