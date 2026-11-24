/** Build fast, read-only relationship lookups from canonical relationship records. */
export function buildRelationshipIndex(persons, relationships) {
  const personIds = new Set((persons || []).map(p => p.id));
  const parents = new Map(), children = new Map(), spouses = new Map(), guardians = new Map();
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const rel of relationships || []) {
    if (!personIds.has(rel.fromPersonId) || !personIds.has(rel.toPersonId)) continue;
    if (rel.type === "parent_of" || rel.type === "adoptive_parent_of") {
      add(children, rel.fromPersonId, rel.toPersonId);
      add(parents, rel.toPersonId, rel.fromPersonId);
    } else if (rel.type === "spouse_of") {
      add(spouses, rel.fromPersonId, rel.toPersonId);
      add(spouses, rel.toPersonId, rel.fromPersonId);
    } else if (rel.type === "guardian_of") {
      add(guardians, rel.fromPersonId, rel.toPersonId);
    }
  }
  const values = map => new Map([...map].map(([id, set]) => [id, [...set]]));
  return {
    parents: values(parents),
    children: values(children),
    spouses: values(spouses),
    guardians: values(guardians)
  };
}

/** Returns an ancestor/descendant component without mutating source records. */
export function getFamilyComponent(personId, index) {
  const seen = new Set();
  const queue = [personId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of [
      ...(index.parents.get(id) || []),
      ...(index.children.get(id) || []),
      ...(index.spouses.get(id) || [])
    ]) if (!seen.has(next)) queue.push(next);
  }
  return [...seen];
}
