const GEN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

// 兩種版式的尺寸：modern＝現代橫向卡片；classic＝古式豎排（姓名直書、自上而下按「世」排列）
const METRICS = {
  modern: { w: 156, h: 88, coupleGap: 64, unitGap: 44, rowGap: 84, padX: 50, padY: 40, leftMargin: 0, chip: "夫妻" },
  classic: { w: 58, h: 152, coupleGap: 64, unitGap: 34, rowGap: 96, padX: 50, padY: 40, leftMargin: 70, chip: "配" }
};

const genderRank = p => (p.gender === "male" ? 0 : p.gender === "female" ? 1 : 2);
const sortKey = p => [p.siblingOrder ?? Number.MAX_SAFE_INTEGER, String(p.birthDate || ""), String(p.name || "")];
function comparePeople(a, b) {
  const x = sortKey(a), y = sortKey(b);
  return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2], "zh-Hant");
}

/**
 * 以「中心人物」為基準取上下三代，按家庭單元（夫妻並排）排版：
 * 夫妻相鄰，子女從夫妻連線中點垂下，父母盡量置於子女正上方。
 * 回傳已算好座標的節點、線條與標籤，主程式只負責繪製。
 */
export function buildTreeLayout(persons, relationships, centerId, { maxGenerations = 3, maxNodes = 60, mode = "modern" } = {}) {
  const M = METRICS[mode] || METRICS.modern;
  const byId = new Map(persons.map(person => [person.id, person]));
  if (!byId.has(centerId)) return { nodes: [], lines: [], chips: [], generations: [], width: 700, height: 180, truncated: false, centerId: null, mode };

  // ---- 1. 以關係向外展開，決定每個人所在的「世」 ----
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
      if (Math.abs(nextLevel) > maxGenerations || levels.size >= maxNodes) { truncated = true; continue; }
      levels.set(next, nextLevel);
      queue.push(next);
    }
  }

  // ---- 2. 整理父子、夫妻關係（只取畫面內的人） ----
  const parentsIn = new Map(), childrenIn = new Map(), spouseAdj = new Map();
  const seenParent = new Set();
  for (const rel of relationships) {
    if (!levels.has(rel.fromPersonId) || !levels.has(rel.toPersonId)) continue;
    if (rel.type === "parent_of" || rel.type === "adoptive_parent_of") {
      const key = rel.fromPersonId + ">" + rel.toPersonId;
      if (seenParent.has(key)) continue;
      seenParent.add(key);
      if (!parentsIn.has(rel.toPersonId)) parentsIn.set(rel.toPersonId, []);
      parentsIn.get(rel.toPersonId).push({ id: rel.fromPersonId, adoptive: rel.type === "adoptive_parent_of" });
      if (!childrenIn.has(rel.fromPersonId)) childrenIn.set(rel.fromPersonId, []);
      childrenIn.get(rel.fromPersonId).push(rel.toPersonId);
    } else if (rel.type === "spouse_of") {
      if (levels.get(rel.fromPersonId) !== levels.get(rel.toPersonId)) continue;
      for (const [a, b] of [[rel.fromPersonId, rel.toPersonId], [rel.toPersonId, rel.fromPersonId]]) {
        if (!spouseAdj.has(a)) spouseAdj.set(a, new Set());
        spouseAdj.get(a).add(b);
      }
    }
  }

  // ---- 3. 同一世中把夫妻併成「家庭單元」 ----
  const rowIds = new Map();
  for (const [id, level] of levels) {
    if (!rowIds.has(level)) rowIds.set(level, []);
    rowIds.get(level).push(id);
  }
  const sortedLevels = [...rowIds.keys()].sort((a, b) => a - b);
  const rowUnits = new Map();
  const unitOf = new Map();
  for (const level of sortedLevels) {
    const ids = rowIds.get(level), seen = new Set(), units = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const group = [], stack = [id];
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur)) continue;
        seen.add(cur); group.push(cur);
        for (const sp of spouseAdj.get(cur) || []) if (!seen.has(sp)) stack.push(sp);
      }
      const people = group.map(g => byId.get(g)).sort((a, b) => genderRank(a) - genderRank(b) || comparePeople(a, b));
      let members = people.map(p => p.id);
      if (members.length === 3) { // 一人多配偶：核心人物居中，兩側各一
        const hub = members.reduce((best, m) => ((spouseAdj.get(m)?.size || 0) > (spouseAdj.get(best)?.size || 0) ? m : best), members[0]);
        const others = members.filter(m => m !== hub);
        members = [others[0], hub, others[1]];
      }
      const unit = { members, level, width: members.length * M.w + (members.length - 1) * M.coupleGap, x: 0 };
      members.forEach(m => unitOf.set(m, unit));
      units.push(unit);
    }
    rowUnits.set(level, units);
  }

  const center = id => { const u = unitOf.get(id); return u.x + u.members.indexOf(id) * (M.w + M.coupleGap) + M.w / 2; };
  const unitKey = unit => {
    const blood = unit.members.map(m => byId.get(m)).filter(p => (parentsIn.get(p.id) || []).length);
    return (blood.length ? blood : unit.members.map(m => byId.get(m))).sort(comparePeople)[0];
  };
  const anchorOf = unit => {
    const xs = [];
    for (const m of unit.members) for (const p of parentsIn.get(m) || []) if (unitOf.has(p.id) && unitOf.get(p.id).placed) xs.push(center(p.id));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const childAnchorOf = unit => {
    const xs = [];
    for (const m of unit.members) for (const c of childrenIn.get(m) || []) if (unitOf.has(c)) xs.push(center(c));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  // 依期望位置逐個擺放，保證最小間距，再整排平移以貼近期望
  function placeRow(units, desiredLeft) {
    let prevEnd = -Infinity;
    const placed = units.map((unit, i) => {
      const want = desiredLeft[i] ?? unit.x;
      const left = Math.max(want, prevEnd + M.unitGap);
      prevEnd = left + unit.width;
      return left;
    });
    const diffs = [];
    units.forEach((unit, i) => { if (desiredLeft[i] != null) diffs.push(desiredLeft[i] - placed[i]); });
    const shift = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
    units.forEach((unit, i) => { unit.x = placed[i] + shift; });
    // 再讓每個單元盡量回到「正對子女／父母」的位置（只受左右鄰居限制），使單親、獨子的連線盡量垂直
    for (let sweep = 0; sweep < 3; sweep++) {
      units.forEach((unit, i) => {
        if (desiredLeft[i] == null) return;
        const lo = i > 0 ? units[i - 1].x + units[i - 1].width + M.unitGap : -Infinity;
        const hi = i < units.length - 1 ? units[i + 1].x - M.unitGap - unit.width : Infinity;
        unit.x = Math.min(Math.max(desiredLeft[i], lo), Math.max(hi, lo));
      });
    }
  }

  // 由上而下：先定各世的左右次序，再初步定位
  sortedLevels.forEach((level, rowIndex) => {
    const units = rowUnits.get(level);
    // 夫妻雙方都有父母時，依各自父母的左右位置排列，讓兩家的連線各走各的、不交叉
    if (rowIndex > 0) {
      for (const u of units) {
        if (u.members.length !== 2) continue;
        const ax = m => { const xs = (parentsIn.get(m) || []).filter(p => unitOf.get(p.id)?.placed).map(p => center(p.id)); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
        const a0 = ax(u.members[0]), a1 = ax(u.members[1]);
        if (a0 != null && a1 != null && a0 > a1) u.members.reverse();
      }
    }
    const info = units.map(unit => ({ unit, anchor: anchorOf(unit), key: unitKey(unit) }));
    info.sort((a, b) => {
      if (a.anchor != null && b.anchor != null && Math.abs(a.anchor - b.anchor) > 1) return a.anchor - b.anchor;
      if ((a.anchor == null) !== (b.anchor == null)) return a.anchor == null ? 1 : -1;
      return comparePeople(a.key, b.key);
    });
    const ordered = info.map(i => i.unit);
    rowUnits.set(level, ordered);
    units.forEach(u => { u.x = 0; });
    let cursor = 0;
    ordered.forEach(u => { u.x = cursor; cursor += u.width + M.unitGap; });
    if (rowIndex > 0) placeRow(ordered, info.map(i => (i.anchor == null ? null : i.anchor - i.unit.width / 2)));
    ordered.forEach(u => { u.placed = true; });
  });
  // 反覆「父母對準子女、子女對準父母」幾輪，讓整體左右均衡
  for (let pass = 0; pass < 3; pass++) {
    for (let r = sortedLevels.length - 2; r >= 0; r--) {
      const units = rowUnits.get(sortedLevels[r]);
      placeRow(units, units.map(u => { const a = childAnchorOf(u); return a == null ? null : a - u.width / 2; }));
    }
    for (let r = 1; r < sortedLevels.length; r++) {
      const units = rowUnits.get(sortedLevels[r]);
      placeRow(units, units.map(u => { const a = anchorOf(u); return a == null ? null : a - u.width / 2; }));
    }
  }

  // 最後再讓父母回到子女正上方，單親獨子的連線才會垂直
  for (let r = sortedLevels.length - 2; r >= 0; r--) {
    const units = rowUnits.get(sortedLevels[r]);
    placeRow(units, units.map(u => { const a = childAnchorOf(u); return a == null ? null : a - u.width / 2; }));
  }

  // ---- 4. 座標歸一、輸出節點 ----
  let minX = Infinity, maxX = -Infinity;
  for (const units of rowUnits.values()) for (const u of units) { minX = Math.min(minX, u.x); maxX = Math.max(maxX, u.x + u.width); }
  const offset = M.padX + M.leftMargin - minX;
  const width = Math.max(700, maxX - minX + M.padX * 2 + M.leftMargin);
  const height = Math.max(180, M.padY * 2 + sortedLevels.length * M.h + (sortedLevels.length - 1) * M.rowGap);
  const nodes = [], pos = new Map();
  sortedLevels.forEach((level, rowIndex) => {
    for (const u of rowUnits.get(level)) {
      u.members.forEach((m, i) => {
        const node = { id: m, person: byId.get(m), level, x: u.x + offset + i * (M.w + M.coupleGap), y: M.padY + rowIndex * (M.h + M.rowGap), width: M.w, height: M.h };
        nodes.push(node); pos.set(m, node);
      });
    }
  });

  // ---- 5. 線條：夫妻橫線＋「夫妻中點 → 子女」的匯流線 ----
  const lines = [], chips = [];
  for (const level of sortedLevels) {
    for (const u of rowUnits.get(level)) {
      for (let i = 0; i + 1 < u.members.length; i++) {
        const a = pos.get(u.members[i]), b = pos.get(u.members[i + 1]);
        if (!spouseAdj.get(a.id)?.has(b.id)) continue;
        const y = a.y + M.h / 2;
        lines.push({ kind: "spouse", d: "M " + (a.x + M.w) + " " + y + " H " + b.x });
        chips.push({ x: (a.x + M.w + b.x) / 2, y, text: M.chip });
      }
    }
  }
  const families = new Map();
  for (const [childId, list] of parentsIn) {
    if (!pos.has(childId)) continue;
    const parents = [...new Set(list.map(p => p.id))].filter(p => pos.has(p)).sort();
    if (!parents.length) continue;
    const key = parents.join("|");
    if (!families.has(key)) families.set(key, { parents, kids: [] });
    families.get(key).kids.push({ id: childId, adoptive: list.find(p => p.id === parents[0])?.adoptive || false });
  }
  // 先算出每個家庭的幾何資訊，再按「父母所在世」把互相重疊的匯流線分到不同高度，避免不同家庭的線混在一起
  const recs = [];
  for (const { parents, kids } of families.values()) {
    const pn = parents.map(p => pos.get(p));
    const bottom = Math.max(...pn.map(n => n.y + M.h));
    const childTop = Math.min(...kids.map(k => pos.get(k.id).y));
    let ax, startY, trunk = "";
    const sorted = [...pn].sort((a, b) => a.x - b.x);
    const adjacent = sorted.length === 2 && unitOf.get(sorted[0].id) === unitOf.get(sorted[1].id) && Math.abs(unitOf.get(sorted[0].id).members.indexOf(sorted[0].id) - unitOf.get(sorted[1].id).members.indexOf(sorted[1].id)) === 1 && spouseAdj.get(sorted[0].id)?.has(sorted[1].id);
    if (adjacent) {
      ax = (sorted[0].x + M.w + sorted[1].x) / 2; startY = sorted[0].y + M.h / 2;
    } else if (pn.length === 1) {
      ax = pn[0].x + M.w / 2; startY = bottom;
    } else {
      ax = pn.reduce((s, n) => s + n.x + M.w / 2, 0) / pn.length;
      const joinY = bottom + 16;
      startY = joinY;
      for (const n of pn) trunk += "M " + (n.x + M.w / 2) + " " + (n.y + M.h) + " V " + joinY + " H " + ax + " ";
    }
    const xs = kids.map(k => pos.get(k.id).x + M.w / 2);
    recs.push({ kids, ax, startY, trunk, xs, bottom, childTop, left: Math.min(ax, ...xs), right: Math.max(ax, ...xs), gap: Math.round(bottom), lane: 0 });
  }
  const byGap = new Map();
  for (const r of recs) { if (!byGap.has(r.gap)) byGap.set(r.gap, []); byGap.get(r.gap).push(r); }
  for (const group of byGap.values()) {
    group.sort((a, b) => a.left - b.left);
    const laneEnd = [];
    for (const r of group) {
      let lane = laneEnd.findIndex(end => end < r.left - 8);
      if (lane < 0) { lane = laneEnd.length; laneEnd.push(0); }
      laneEnd[lane] = r.right; r.lane = lane; r.lanes = 0;
    }
    for (const r of group) r.lanes = laneEnd.length;
  }
  for (const r of recs) {
    const step = Math.min(14, (M.rowGap / 2 - 22) / Math.max(1, (r.lanes - 1) / 2));
    const busY = Math.round((r.bottom + r.childTop) / 2 + (r.lane - (r.lanes - 1) / 2) * step);
    let d = r.trunk + "M " + r.ax + " " + r.startY + " V " + busY + " M " + r.left + " " + busY + " H " + r.right;
    let dashed = "";
    r.kids.forEach((k, i) => {
      const seg = "M " + r.xs[i] + " " + busY + " V " + pos.get(k.id).y + " ";
      if (k.adoptive) dashed += seg; else d += " " + seg;
    });
    lines.push({ kind: "family", d });
    if (dashed) lines.push({ kind: "adopt", d: dashed });
  }

  const generations = mode === "classic"
    ? sortedLevels.map((level, i) => ({ y: M.padY + i * (M.h + M.rowGap) + M.h / 2, text: "第" + (GEN_NUM[i] || i + 1) + "世" }))
    : [];
  return { nodes, lines, chips, generations, width, height, truncated, centerId, mode };
}
