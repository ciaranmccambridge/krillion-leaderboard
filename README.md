# Krillion Leaderboard

The office's daily [Krillion](https://krillion.io/) competition, replacing the Slack thread of screenshots.

- Sign in with Google. In Krillion, tap **Copy your result**, then paste it into the site.
  The site reads the score, the dive number and the emoji dive log from the pasted text, and you submit.
- **Submissions close at 18:00 UK time; results appear at 18:01.** The day's top three get **3 / 2 / 1 points**.
  Ties share the place and each gets the points, so the next place is skipped: 900, 900, 800 -> 3, 3, 1.
- At 18:02 a nightly job saves the day's final results and the overall totals.
- Tabs: **Daily** (today's live standings with everyone's dive log, then previous days), **Add Score**
  (the default), and **Overall** (points, plus how many 🌟 Krillions, 🏮 Deep cuts, 🦑 Rares,
  🐟 Schoolers and 🫧 Plankton each person has found, counted from their dive logs).
- Styled after the game: dark water, Silkscreen pixel type, scanlines. The logo is `assets/krillion-logo.png`.

Same approach as `quiz-site`: no build step and no framework. It is static HTML/CSS/JS on GitHub Pages, with Firebase (Auth +
Firestore) on the free Spark plan.

---

## Quick start

```bash
npm test          # dates/cutoff, points + ties, parsing pasted results, wiring checks
npm run serve     # http://localhost:8765
```

The page needs a Firebase config before you can sign in (below). Until then it shows a banner.

---

## One-off setup

### 1. Firebase project (free Spark plan)

1. [console.firebase.google.com](https://console.firebase.google.com) -> **Add project** (e.g.
   `krillion-leaderboard`). Skip Analytics.
2. **Build -> Authentication -> Get started -> Sign-in method -> Google -> Enable**.
3. **Build -> Firestore Database -> Create database** -> production mode -> `europe-west2`.
4. **Project settings -> Your apps -> Web (`</>`)**. Register it, then paste the `firebaseConfig` values into
   `FIREBASE_CONFIG` in **`assets/firebase.js`**. This config is meant to be public, so commit it.
5. **Firestore -> Rules**: paste `firestore.rules` and click **Publish**.
6. **Firestore -> Indexes**: nothing is needed. Every query uses a single field.

### 2. GitHub Pages

1. Push this folder to a **public** repo (`node_modules/` and `samples/` are gitignored).
2. **Settings -> Pages ->** deploy from branch `main`, folder `/ (root)`.
3. Back in Firebase: **Authentication -> Settings -> Authorized domains -> Add domain** ->
   `<your-user>.github.io`. `localhost` is already allowed for local testing.

### 3. The nightly job (18:02)

`.github/workflows/nightly-results.yml` runs `scripts/nightly-results.mjs` every evening.

1. Firebase -> **Project settings -> Service accounts -> Generate new private key**. This downloads a JSON file.
2. GitHub repo -> **Settings -> Secrets and variables -> Actions -> New repository secret**.
   Name it `FIREBASE_SERVICE_ACCOUNT` and paste the **whole JSON file** as the value. Then delete the downloaded file,
   and never commit it.
3. **Actions -> Nightly results -> Run workflow** (tick *force*) to check it works.

What it does each night: it recomputes `results/{date}` for each finished day, plus
`standings/overall`, from all scores. Because it recomputes everything, a missed night fixes itself
on the next run.

GitHub's cron runs in UTC, so the workflow fires at 17:02 and 18:02 UTC. The script checks
London time and only acts once the day's results are final (18:01), which covers both GMT and BST.
GitHub sometimes starts scheduled runs late. That's fine, because the site works out the day's results itself
from 18:01, so a late run only delays the saved summary.

To run it locally:
```bash
FIREBASE_SERVICE_ACCOUNT="$(cat ~/path/to/key.json)" node scripts/nightly-results.mjs --force --dry-run
```

---

## How it fits together

| Firestore path | Written by | Kept |
|---|---|---|
| `users/{uid}` | the person (nickname, avatar) | forever |
| `scores/{date}_{uid}` | the person, before 18:00 | forever |
| `results/{date}` | nightly job | forever |
| `standings/overall` | nightly job | forever |

**Cheap reads.** The page reads `standings/overall` plus only the scores the job hasn't processed yet,
which is normally just today's. It does not read every score ever, so it stays inside the free tier's
50k reads/day indefinitely. If the job stops running, the page adds up the unprocessed days itself, so the
leaderboard stays correct. It just gets slowly more expensive until the job runs again.

**The 18:00 cutoff is enforced by the server, not just the UI.** The rules force `updatedAt` to the
server's clock. `assets/scoring.js` ignores any score updated after 18:00 London on its day, and
the rules reject writes dated for any other day.

**Points logic** lives in `assets/scoring.js` and the **time logic** in `assets/dates.js`. Both are pure
modules shared by the page and the nightly job, so the two can't disagree.

### Layout

```
index.html                  the whole app (sign-in, Today, Leaderboard, History)
assets/firebase.js          >>> PASTE YOUR CONFIG HERE <<<  + auth/Firestore helpers
assets/app.js               UI wiring
assets/scoring.js           3/2/1 points, ties, overall totals
assets/dates.js             London day, 18:00 cutoff, 18:01 results
assets/result.js            reads the pasted "Copy your result" text
assets/styles.css           Krillion-style dark pixel theme
firestore.rules             paste into the Firebase console
scripts/nightly-results.mjs             nightly job
.github/workflows/nightly-results.yml   its schedule
tests/                      node tests + wiring check
```

---

## Things to know

- **Test mode: add `?test` to the URL** (e.g. `http://localhost:8765/?test`). Every paste adds a fake
  player ("Tester 1", "Tester 2"…), and a pretend clock switches between 17:00 and 18:02, so you
  can try the whole flow with one Google account at any time of day. Fake scores are kept in that
  browser only and never sent to Firebase. Clear them with the button, or just drop `?test`.

- **Only the daily dive counts.** Endless Dive results (`Krillion ∞ #…`) are rejected.
- **Emoji → category mapping** lives in `CATEGORIES` in `assets/result.js`. Counts are worked out
  from the saved dive logs, so fixing the mapping there corrects every past day too.
- **Honour system.** The site trusts the pasted result, just as the Slack thread did. Each
  person's dive number and dive log are shown next to their score, so a mismatch stands out.
- **One result per person per day, no editing.** The paste box only accepts a paste (no typing), and once
  you've submitted, that's it. The Firestore rules allow creating a score but never updating or deleting
  one. To fix someone's score or remove a joke entry, edit it in the Firestore console, then run the
  workflow by hand so results and standings update.
- **Names.** Everyone starts with their Google first name. Click your name at the bottom of the page to change it.
  Names on past days update too.
- **GitHub pauses scheduled workflows after 60 days with no commits** to a public repo, and emails you
  first. Scores and the leaderboard keep working (see *Cheap reads*), but reads slowly creep up until you re-enable it under **Actions**.
- **Anyone with a Google account can sign in.** That's by design for a link shared in Slack. To lock
  it to a work domain later, add `&& request.auth.token.email.matches('.*@yourcompany[.]com$')` to
  `signedIn()` in `firestore.rules`.
