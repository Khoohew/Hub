const PREFIXES = new Set(["P", "R", "E", "M", "S", "H"]);
export function createId(prefix) {
  if (!PREFIXES.has(prefix)) throw new Error("Unknown record ID prefix.");
  return prefix + "-" + crypto.randomUUID();
}
export function nowIso() {
  return new Date().toISOString();
}
