import { buildRelationshipIndex } from "./relationship-index.js";

const ORD = ["", "長", "次", "三", "四", "五", "六", "七", "八", "九", "十"];
const male = p => p?.gender === "male";
const female = p => p?.gender === "female";
const pick = (p, m, f, u) => (male(p) ? m : female(p) ? f : u);

/**
 * 相對於「中心人物」的近親稱謂（只讀、不寫入資料）。
 * 回傳 Map<personId, string>；找不到明確稱謂的人不放入 Map。
 */
export function kinshipLabels(persons, relationships, centerId) {
  const byId = new Map(persons.map(p => [p.id, p]));
  const out = new Map();
  if (!byId.has(centerId)) return out;
  const idx = buildRelationshipIndex(persons, relationships);
  const parentsOf = id => idx.parents.get(id) || [];
  const childrenOf = id => idx.children.get(id) || [];
  const spousesOf = id => idx.spouses.get(id) || [];
  const set = (id, label) => { if (id && label && !out.has(id) && id !== centerId) out.set(id, label); };
  const sib = (p, c) => {
    // 以排行比較長幼；缺資料時只給性別稱謂
    const older = p.siblingOrder != null && c.siblingOrder != null ? p.siblingOrder < c.siblingOrder : null;
    return older;
  };
  const childTerm = p => {
    const o = ORD[p.siblingOrder] || "";
    return o ? o + pick(p, "子", "女", "子女") : pick(p, "兒子", "女兒", "子女");
  };

  const ended = new Set(relationships.filter(r => r.type === "spouse_of" && r.status === "divorced").map(r => [r.fromPersonId, r.toPersonId].sort().join("|")));
  const isEx = (a, b) => ended.has([a, b].sort().join("|"));
  const C = byId.get(centerId);
  out.set(centerId, "本人" + (C.siblingOrder && ORD[C.siblingOrder] ? " " + ORD[C.siblingOrder] + pick(C, "子", "女", "") : ""));

  // 配偶、子女、子女的配偶、孫輩
  for (const s of spousesOf(centerId)) set(s, isEx(centerId, s) ? pick(byId.get(s), "前夫", "前妻", "前配偶") : pick(byId.get(s), "丈夫", "妻子", "配偶"));
  for (const s of spousesOf(centerId)) {
    if (isEx(centerId, s)) continue;
    const sp = byId.get(s);
    for (const p of parentsOf(s)) set(p, female(sp) ? pick(byId.get(p), "岳父", "岳母", "岳父母") : male(sp) ? pick(byId.get(p), "公公", "婆婆", "公婆") : male(C) ? pick(byId.get(p), "岳父", "岳母", "岳父母") : female(C) ? pick(byId.get(p), "公公", "婆婆", "公婆") : pick(byId.get(p), "配偶之父", "配偶之母", "配偶父母"));
  }
  for (const k of childrenOf(centerId)) {
    const kid = byId.get(k);
    set(k, childTerm(kid));
    for (const ks of spousesOf(k)) set(ks, male(kid) ? "兒媳" : female(kid) ? "女婿" : "子女配偶");
    for (const g of childrenOf(k)) {
      const gk = byId.get(g);
      set(g, male(kid) ? pick(gk, "孫子", "孫女", "孫輩") : female(kid) ? pick(gk, "外孫", "外孫女", "外孫輩") : "孫輩");
      for (const gg of childrenOf(g)) set(gg, "曾孫輩");
    }
  }

  // 父母、繼父母、祖輩
  const visitedUp = new Set([centerId]);
  const walkUp = (id, depth, side) => {
    for (const p of parentsOf(id)) {
      if (visitedUp.has(p)) continue; // 資料若出現環，避免無限遞迴
      visitedUp.add(p);
      const pp = byId.get(p);
      let term;
      if (depth === 1) term = pick(pp, "父親", "母親", "父母");
      else if (depth === 2) term = (side === "m" ? "外" : "") + pick(pp, "祖父", "祖母", "祖輩");
      else if (depth === 3) term = (side === "m" ? "外" : "") + pick(pp, "曾祖父", "曾祖母", "曾祖輩");
      else term = "高祖輩";
      set(p, term);
      for (const ps of spousesOf(p)) if (!parentsOf(id).includes(ps)) set(ps, depth === 1 ? pick(byId.get(ps), "繼父", "繼母", "繼親") : "祖輩配偶");
      walkUp(p, depth + 1, depth === 1 ? (female(pp) ? "m" : "f") : side);
    }
  };
  walkUp(centerId, 1, "f");

  // 兄弟姐妹、其配偶、侄甥
  for (const p of parentsOf(centerId)) {
    for (const s of childrenOf(p)) {
      if (s === centerId) continue;
      const sp = byId.get(s), older = sib(sp, C);
      set(s, male(sp) ? (older === true ? "兄" : older === false ? "弟" : "兄弟") : female(sp) ? (older === true ? "姐" : older === false ? "妹" : "姐妹") : "兄弟姐妹");
      for (const ss of spousesOf(s)) {
        const x = byId.get(ss);
        set(ss, male(sp) ? (older === false ? "弟媳" : older === true ? "嫂" : "兄弟配偶") : female(sp) ? (older === true ? "姐夫" : older === false ? "妹夫" : "姐妹配偶") : "手足配偶");
        void x;
      }
      for (const n of childrenOf(s)) {
        const np = byId.get(n);
        set(n, male(sp) ? pick(np, "侄子", "侄女", "侄輩") : female(sp) ? pick(np, "外甥", "外甥女", "外甥輩") : "侄甥輩");
      }
    }
  }

  // 伯叔姑舅姨及其配偶、堂表兄弟姐妹
  for (const p of parentsOf(centerId)) {
    const parent = byId.get(p), viaFather = !female(parent);
    for (const gp of parentsOf(p)) {
      for (const u of childrenOf(gp)) {
        if (u === p) continue;
        const up = byId.get(u), older = sib(up, parent);
        const term = viaFather
          ? (male(up) ? (older === true ? "伯父" : older === false ? "叔父" : "伯叔") : female(up) ? "姑母" : "父輩")
          : (male(up) ? "舅父" : female(up) ? "姨母" : "父輩");
        set(u, term);
        for (const us of spousesOf(u)) {
          set(us, viaFather
            ? (male(up) ? (older === true ? "伯母" : older === false ? "嬸母" : "伯叔母") : "姑父")
            : (male(up) ? "舅母" : "姨父"));
        }
        for (const cz of childrenOf(u)) {
          const cp = byId.get(cz);
          const kind = viaFather && male(up) ? "堂" : "表";
          set(cz, kind + pick(cp, "兄弟", "姐妹", "手足"));
        }
      }
    }
  }
  return out;
}

/** 給「家庭關係」清單用：從目前人物看，某條關係記錄中「對方」是什麼。 */
export function relationRoleLabel(rel, selfId, other) {
  const g = other?.gender;
  const pickg = (m, f, u) => (g === "male" ? m : g === "female" ? f : u);
  if (rel.type === "parent_of") return rel.fromPersonId === selfId ? pickg("兒子", "女兒", "子女") : pickg("父親", "母親", "父母");
  if (rel.type === "adoptive_parent_of") return rel.fromPersonId === selfId ? pickg("養子", "養女", "養子女") : pickg("養父", "養母", "養父母");
  if (rel.type === "spouse_of") return rel.status === "divorced" ? pickg("前夫", "前妻", "前配偶") : pickg("丈夫", "妻子", "配偶");
  if (rel.type === "guardian_of") return rel.fromPersonId === selfId ? "被監護人" : "監護人";
  if (rel.type === "sibling_of") return pickg("兄弟", "姐妹", "兄弟姐妹");
  return "親屬";
}
