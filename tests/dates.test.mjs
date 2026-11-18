// Run: node tests/dates.test.mjs
// The London day, the 18:00 cutoff and 18:01 results, across midnight and both DST changes.

import { createChecker } from './helpers.mjs';
import {
  londonDate, cutoffInstant, londonInstant, isDayClosed, isDayFinal, resultsInstant, isOnTime, addDays, formatDay, formatDuration,
  CUTOFF_LABEL, RESULTS_LABEL,
} from '../assets/dates.js';

const { check, report } = createChecker('dates');
const utc = (iso) => Date.parse(iso);

// --- which day is it?
check('winter: 23:30 UTC is still the same London day', londonDate(utc('2026-01-15T23:30:00Z')), '2026-01-15');
check('summer: 23:30 UTC is already tomorrow in London', londonDate(utc('2026-07-15T23:30:00Z')), '2026-07-16');
check('summer: 22:59 UTC is still today', londonDate(utc('2026-07-15T22:59:00Z')), '2026-07-15');

// --- 18:00 London cutoff in UTC
check('GMT cutoff is 18:00 UTC', new Date(cutoffInstant('2026-01-15')).toISOString(), '2026-01-15T18:00:00.000Z');
check('BST cutoff is 17:00 UTC', new Date(cutoffInstant('2026-07-15')).toISOString(), '2026-07-15T17:00:00.000Z');
check('day of spring-forward (29 Mar 2026)', new Date(cutoffInstant('2026-03-29')).toISOString(), '2026-03-29T17:00:00.000Z');
check('day of fall-back (25 Oct 2026)', new Date(cutoffInstant('2026-10-25')).toISOString(), '2026-10-25T18:00:00.000Z');
check('19:00 BST in UTC', new Date(londonInstant('2026-07-15', 19)).toISOString(), '2026-07-15T18:00:00.000Z');
check('results at 18:01 GMT', new Date(resultsInstant('2026-01-15')).toISOString(), '2026-01-15T18:01:00.000Z');
check('results at 18:01 BST', new Date(resultsInstant('2026-07-15')).toISOString(), '2026-07-15T17:01:00.000Z');
check('labels', [CUTOFF_LABEL, RESULTS_LABEL], ['18:00', '18:01']);

// --- closed / on time
check('17:59 London winter: open', isDayClosed('2026-01-15', utc('2026-01-15T17:59:00Z')), false);
check('18:00 London winter: closed', isDayClosed('2026-01-15', utc('2026-01-15T18:00:00Z')), true);
check('17:30 UTC in summer is 18:30 London: closed', isDayClosed('2026-07-15', utc('2026-07-15T17:30:00Z')), true);
check('18:00:30: closed but not final', isDayFinal('2026-01-15', utc('2026-01-15T18:00:30Z')), false);
check('18:01: final', isDayFinal('2026-01-15', utc('2026-01-15T18:01:00Z')), true);
check('past days are closed', isDayClosed('2026-01-14', utc('2026-01-15T09:00:00Z')), true);
check('future days are open', isDayClosed('2026-01-16', utc('2026-01-15T09:00:00Z')), false);
check('updated 17:59 counts', isOnTime('2026-01-15', utc('2026-01-15T17:59:59Z')), true);
check('updated 18:01 does not', isOnTime('2026-01-15', utc('2026-01-15T18:01:00Z')), false);
check('missing timestamp does not', isOnTime('2026-01-15', NaN), false);

// --- helpers
check('addDays across month end', addDays('2026-01-31', 1), '2026-02-01');
check('addDays across year end', addDays('2026-01-01', -1), '2025-12-31');
check('formatDay', formatDay('2026-11-18'), 'Wed 18 Nov');
check('formatDuration hours', formatDuration(2 * 3600e3 + 14 * 60e3), '2h 14m');
check('formatDuration minutes', formatDuration(9 * 60e3), '9m');

report();
