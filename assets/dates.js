// Everything time-related lives here, because "what day is it?" has exactly one
// right answer for this site: the office's day, in London. Someone uploading
// from Singapore at 2am their time is still playing the London day.
//
// Pure module -- no DOM, no Firebase -- so node tests and the nightly job can
// both import it.

export const TIME_ZONE = 'Europe/London';

/** Submissions close at this London hour (18:00). Scores updated later don't count. */
export const CUTOFF_HOUR = 18;

/** Results are revealed this many minutes after the cutoff (18:01). */
export const RESULTS_DELAY_MINUTES = 1;

const pad2 = (n) => String(n).padStart(2, '0');
export const CUTOFF_LABEL = `${pad2(CUTOFF_HOUR)}:00`;
export const RESULTS_LABEL = `${pad2(CUTOFF_HOUR)}:${pad2(RESULTS_DELAY_MINUTES)}`;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Wall-clock parts of an instant, as seen in London. */
export function londonParts(instant = new Date()) {
  const parts = {};
  for (const { type, value } of partsFormatter.formatToParts(new Date(instant))) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts; // { year, month, day, hour, minute, second }
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for the London day containing `instant`. */
export function londonDate(instant = new Date()) {
  const { year, month, day } = londonParts(instant);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function isValidDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * The instant (ms since epoch) at which `hour`:00 London time falls on `date`.
 * Works across BST/GMT because it measures London's offset at that moment
 * rather than assuming one. 18:00 and 19:00 are never inside a DST gap.
 */
export function londonInstant(date, hour) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const seen = londonParts(guess);
  const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  return guess - (seenAsUtc - guess);
}

/** When submissions close for `date`, in ms. */
export function cutoffInstant(date) {
  return londonInstant(date, CUTOFF_HOUR);
}

/** When results for `date` are revealed (18:01), in ms. */
export function resultsInstant(date) {
  return cutoffInstant(date) + RESULTS_DELAY_MINUTES * 60_000;
}

/** The competition runs Monday to Friday only. */
export function isPlayDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday, 6 = Saturday
  return weekday >= 1 && weekday <= 5;
}

/** The next Monday-to-Friday date after `date`. */
export function nextPlayDay(date) {
  let next = addDays(date, 1);
  while (!isPlayDay(next)) next = addDays(next, 1);
  return next;
}

/** True once submissions for `date` have closed (from 18:00). */
export function isDayClosed(date, now = Date.now()) {
  return Number(now) >= cutoffInstant(date);
}

/** True once `date`'s results are final and count towards Overall (from 18:01). */
export function isDayFinal(date, now = Date.now()) {
  return Number(now) >= resultsInstant(date);
}

/** Did this entry arrive before its day's cutoff? */
export function isOnTime(date, updatedAtMs) {
  return Number.isFinite(updatedAtMs) && updatedAtMs < cutoffInstant(date);
}

/** Calendar arithmetic on 'YYYY-MM-DD' strings, independent of time zone. */
export function addDays(date, delta) {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + delta));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** 'Tue 18 Nov' */
export function formatDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return dayFormatter.format(new Date(Date.UTC(y, m - 1, d)));
}

/** '2h 14m' / '9m' for a countdown. */
export function formatDuration(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
