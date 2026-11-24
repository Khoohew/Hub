export function buildTreeLayout(persons, relationships, centerId, { maxGenerations = 3, maxNodes = 60 } = {}) {
  const byId = new Map(persons.map(person => [person.id, person]));
  if (!byId.has(centerId)) return { nodes: [], edges: [], width: 700, height: 180, truncated: false, centerId: null };

  const levels = new Map([[centerId, 0]]);
  const queue = [centerId];
  let truncated = false;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    const level = levels.get(current);
    for (const rel of relationships) {
      let next = null, nextLevel = level;
      if (rel.type === "parent_of" || rel.type === "adoptive_parent_of") {
        if (rel.toPersonId === current) { next = rel.fromPersonId; nextLevel = level - 1; }
        else if (rel.fromPersonId === current) { next = rel.toPersonId; nextLevel = level + 1; }
      } else if (rel.type === "spouse_of" || rel.type === "sibling_of") {
        if (rel.fromPersonId === current) next = rel.toPersonId;
        else if (rel.toPersonId === current) next = rel.fromPersonId;
      }
      if (!next || !byId.has(next) || levels.has(next)) continue;
      if (Math.abs(nextLevel) > maxGenerations || levels.size >= maxNodes) {
        truncated = true;
        continue;
      }
      levels.set(next, nextLevel);
      queue.push(next);
    }
  }

  const rows = new Map();
  for (const [id, level] of levels) {
    if (!rows.has(level)) rows.set(level, []);
    rows.get(level).push(byId.get(id));
  }
  const sortedLevels = [...rows.keys()].sort((a, b) => a - b);
  for (const level of sortedLevels) {
    rows.get(level).sort((a, b) =>
      (a.siblingOrder ?? Number.MAX_SAFE_INTEGER) - (b.siblingOrder ?? Number.MAX_SAFE_INTEGER) ||
      String(a.birthDate || "").localeCompare(String(b.birthDate || "")) ||
      String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant")
    );
  }

  const maxRow = Math.max(1, ...sortedLevels.map(level => rows.get(level).length));
  const width = Math.max(700, maxRow * 180 + 80);
  const height = Math.max(180, sortedLevels.length * 150 + 70);
  const nodes = [];
  const positions = new Map();
  sortedLevels.forEach((level, rowIndex) => {
    const row = rows.get(level);
    const startX = (width - row.length * 180) / 2 + 15;
    row.forEach((person, index) => {
      const node = { id: person.id, person, level, x: startX + index * 180, y: 35 + rowIndex * 150, width: 150, height: 76 };
      nodes.push(node);
      positions.set(person.id, node);
    });
  });

  const edges = [];
  const seenEdges = new Set();
  for (const rel of relationships) {
    if (!positions.has(rel.fromPersonId) || !positions.has(rel.toPersonId)) continue;
    if (!["parent_of", "adoptive_parent_of", "spouse_of", "sibling_of"].includes(rel.type)) continue;
    const key = rel.id || [rel.type, rel.fromPersonId, rel.toPersonId].join("|");
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ from: rel.fromPersonId, to: rel.toPersonId, type: rel.type });
  }
  return { nodes, edges, width, height, truncated, centerId };
}
