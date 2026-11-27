export function ok(data = {}) { return { ok: true, ...data }; }
export function fail(error, extra = {}) { return { ok: false, error: String(error?.message || error), ...extra }; }

export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

export function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
export function round2(n) { return Math.round((toNum(n) + Number.EPSILON) * 100) / 100; }
export function norm(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ' '); }
export function toDateStr(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

export function pick(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined) return obj[k];
  return undefined;
}