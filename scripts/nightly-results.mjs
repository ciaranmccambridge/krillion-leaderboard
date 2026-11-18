// The nightly job. Run by .github/workflows/nightly-results.yml at 18:02 UK,
// just after results are revealed at 18:01.
//
// Rebuilds results/{date} for every closed day, and standings/overall, from all
// scores. It's a full recompute each time, so it's idempotent and self-healing:
// a missed night, an edited score or a renamed player is all fixed by the next
// run. The page reads these summaries instead of every score ever, which keeps
// it well inside Firestore's free tier.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/nightly-results.mjs [--force] [--dry-run]
//
//   --force    skip the "are today's results final yet?" check
//   --dry-run  report what would change, write nothing

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { londonDate, isDayFinal, RESULTS_LABEL } from '../assets/dates.js';
import { closedDayResults, tallyResults } from '../assets/scoring.js';

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const DRY_RUN = args.has('--dry-run');

const now = Date.now();

// GitHub cron is UTC, so the workflow fires at 17:02 and 18:02 UTC. This check
// makes exactly the right one(s) do the work, in both GMT and BST.
if (!FORCE && !isDayFinal(londonDate(now), now)) {
  console.log(`Today's results aren't final until ${RESULTS_LABEL} London time. Nothing to do.`);
  process.exit(0);
}

const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set (paste the service-account JSON into it).');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(key)) });
const db = getFirestore();

const [scoreSnap, userSnap] = await Promise.all([
  db.collection('scores').get(),
  db.collection('users').get(),
]);

const nicknames = Object.fromEntries(userSnap.docs.map((doc) => [doc.id, doc.get('nickname')]));

const scores = scoreSnap.docs.map((doc) => {
  const data = doc.data();
  return {
    ...data,
    displayName: nicknames[data.uid] || data.displayName || '',
    updatedAt: data.updatedAt?.toMillis?.() ?? NaN,
  };
});

const days = closedDayResults(scores, now);
const players = tallyResults(days);
const throughDate = days.reduce((latest, day) => (day.date > latest ? day.date : latest), '0000-00-00');

console.log(`Scores: ${scores.length}, closed days: ${days.length}, players: ${Object.keys(players).length}, through: ${throughDate}`);

if (!DRY_RUN) {
  const writer = db.bulkWriter();
  for (const day of days) writer.set(db.collection('results').doc(day.date), day);
  writer.set(db.collection('standings').doc('overall'), { throughDate, players, updatedAt: new Date() });
  await writer.close();
}

console.log(DRY_RUN ? 'Dry run: nothing written.' : 'Done.');
