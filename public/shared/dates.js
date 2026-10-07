// Dates are handled as plain "YYYY-MM-DD" strings (no time zones, no times) so
// "days left" never shifts around midnight or across DST changes.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtcMs(iso) {
  const m = ISO.exec(iso);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Reject things like 2026-02-31, which Date.UTC silently rolls over.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN;
  return ms;
}

export function isValidDate(iso) {
  return typeof iso === 'string' && !Number.isNaN(toUtcMs(iso));
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(iso, n) {
  return new Date(toUtcMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from, to) {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}
