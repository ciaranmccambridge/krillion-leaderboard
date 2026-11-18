// UI wiring. All the rules about points live in scoring.js, all the rules about
// time live in dates.js, and reading a pasted result lives in result.js; this
// file only fetches, renders and submits.
//
// What gets read from Firestore (kept small so the free tier lasts forever):
//   - standings/overall  totals for every day the nightly job has processed
//   - scores newer than standings.throughDate  (normally just today's)
//   - users              (nicknames + avatars, one doc per person)
//   - results            (fetched once for the History tab)

import {
  isConfigured, watchAuth, signIn, signOut, ensureProfile, setNickname,
  subscribeUsers, subscribeScoresOn, subscribeScoresAfter, subscribeStandings, fetchResults, submitScore,
} from './firebase.js';
import {
  londonDate, isDayClosed, isDayFinal, cutoffInstant, resultsInstant, formatDay, formatDuration,
  CUTOFF_LABEL,
} from './dates.js';
import { validEntries, rankDay, closedDayResults, tallyResults, mergeTallies, rankPlayers } from './scoring.js';
import { parseResult, cleanPuzzle, CATEGORIES } from './result.js';

const $ = (id) => document.getElementById(id);

const els = {
  error: $('error-banner'),
  who: $('who'),
  whoAvatar: $('who-avatar'),
  whoName: $('who-name'),
  signOut: $('sign-out'),
  signinView: $('signin-view'),
  signinButton: $('signin-button'),
  appView: $('app-view'),
  tabs: $('tabs'),
  testBar: $('test-bar'),
  testClock: $('test-clock'),
  testClear: $('test-clear'),
  boot: $('boot'),
  addLoading: $('add-loading'),
  addBody: $('add-body'),
  addKicker: $('add-kicker'),
  addTitle: $('add-title'),
  addStatus: $('add-status'),
  closedCard: $('closed-card'),
  seeResults: $('see-results'),
  todayKicker: $('today-kicker'),
  todayStatus: $('today-status'),
  form: $('submit-form'),
  pasteZone: $('paste-zone'),
  doneCard: $('done-card'),
  doneScore: $('done-score'),
  doneMeta: $('done-meta'),
  seeStandings: $('see-standings'),
  pasteButton: $('paste-button'),
  parsed: $('parsed'),
  parsedScore: $('parsed-score'),
  parsedMeta: $('parsed-meta'),
  submitButton: $('submit-button'),
  submitHint: $('submit-hint'),
  todayTable: $('today-table'),
  todayBody: $('today-body'),
  todayEmpty: $('today-empty'),
  overallStatus: $('overall-status'),
  overallTable: $('overall-table'),
  overallHead: $('overall-head'),
  overallBody: $('overall-body'),
  overallEmpty: $('overall-empty'),
  historyList: $('history-list'),
  historyEmpty: $('history-empty'),
};

const NO_STANDINGS = '0000-00-00';
const MEDALS = ['🥇', '🥈', '🥉'];

const state = {
  user: null,
  users: {},
  standings: null,  // { throughDate, players } or null before the first job run
  todayScores: null, // today's raw score docs; null until the first answer arrives
  scores: [],       // raw score docs dated after standings.throughDate
  scoresLoaded: false,
  standingsLoaded: false,
  results: [],      // finalised days from the job, newest first
  today: londonDate(),
  pastedText: '',   // exactly what came off the clipboard
  parsed: null,     // { score, puzzle, grid } parsed from pastedText
  saving: false,
  unsubScores: null,
  unsubToday: null,
};

// ---------------------------------------------------------------- test mode
//
// Add ?test to the URL (e.g. http://localhost:8765/?test) to try the site with
// one Google account: every paste adds a fake player instead of submitting,
// and a pretend clock flips between 17:00 and 18:02. Fake scores live only in
// this browser's localStorage and are never sent to Firebase, so they can't
// leak into real results. Without ?test none of this runs.

const TEST_MODE = new URLSearchParams(location.search).has('test');
const TEST_KEY = 'krillion-test';
const test = loadTest();

function loadTest() {
  const blank = { scores: [], afterCutoff: false };
  if (!TEST_MODE) return blank;
  try {
    return { ...blank, ...JSON.parse(localStorage.getItem(TEST_KEY) || '{}') };
  } catch {
    return blank;
  }
}

function saveTest() {
  try { localStorage.setItem(TEST_KEY, JSON.stringify(test)); } catch {}
}

/** The time the page believes it is. In test mode, the pretend clock. */
function nowMs() {
  if (!TEST_MODE) return Date.now();
  return test.afterCutoff
    ? resultsInstant(state.today) + 60_000 // 18:02: closed, results final
    : cutoffInstant(state.today) - 60 * 60_000; // 17:00: open
}

/** Real score rows, plus the fake ones in test mode. */
function withTest(rows, keep = () => true) {
  return TEST_MODE ? [...rows, ...test.scores.filter(keep)] : rows;
}

function addTestScore(parsed) {
  const todays = test.scores.filter((entry) => entry.date === state.today);
  test.scores.push({
    uid: `test-${Date.now()}`,
    displayName: `Tester ${todays.length + 1}`,
    date: state.today,
    updatedAt: cutoffInstant(state.today) - 60_000, // always on time
    ...parsed,
  });
  saveTest();
}

function renderTestBar() {
  els.testBar.hidden = !TEST_MODE || !state.user;
  els.testClock.textContent = test.afterCutoff
    ? 'Pretend clock: 18:02 (tap for 17:00)'
    : 'Pretend clock: 17:00 (tap for 18:02)';
}

els.testClock.addEventListener('click', () => {
  test.afterCutoff = !test.afterCutoff;
  saveTest();
  render();
});

els.testClear.addEventListener('click', () => {
  test.scores = [];
  saveTest();
  render();
});

// ------------------------------------------------------------------ helpers

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = !message;
}

function nameFor(uid, fallback = '') {
  return state.users[uid]?.nickname || fallback || state.users[uid]?.googleName || 'Someone';
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

const formatScore = (n) => n.toLocaleString('en-GB');

// '⬛🫧🐟' -> '⬛ 🫧 🐟'. Split on whole emoji (graphemes), not code units.
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const spaceOut = (grid) => [...graphemes.segment(grid || '')].map((part) => part.segment).join(' ');
const medal = (rank) => MEDALS[rank - 1] || String(rank);

// ------------------------------------------------------------------- render

function render() {
  renderTestBar();
  renderAdd();
  renderToday();
  renderOverall();
  renderHistory();
}

function todayRanked() {
  const todays = withTest(state.todayScores || [], (entry) => entry.date === state.today);
  return rankDay(validEntries(todays).map((entry) => ({ ...entry, displayName: nameFor(entry.uid, entry.displayName) })));
}

function renderAdd() {
  // Until today's scores arrive we can't know whether you've already submitted,
  // so show a loader rather than guessing and then flicking over.
  const loaded = state.todayScores !== null;
  els.addLoading.hidden = loaded;
  els.addBody.hidden = !loaded;
  if (!loaded) return;

  const now = nowMs();
  const closed = isDayClosed(state.today, now);
  // In test mode your real score never blocks the form: you keep adding players.
  const mine = TEST_MODE ? null : todayRanked().find((entry) => entry.uid === state.user?.uid);

  els.addKicker.textContent = formatDay(state.today);
  els.addTitle.textContent = mine ? `You scored ${formatScore(mine.score)}` : 'Add your score';
  els.addStatus.textContent = closed
    ? `Submissions closed at ${CUTOFF_LABEL}.`
    : mine
      ? 'One result per day, and yours is in.'
      : `${formatDuration(cutoffInstant(state.today) - now)} until submissions close at ${CUTOFF_LABEL} UK time. One result per person per day.`;

  // One submission per day: once yours is in, the form is gone for good.
  els.form.hidden = closed || Boolean(mine);
  els.closedCard.hidden = !closed || Boolean(mine);
  els.doneCard.hidden = !mine;
  if (mine) {
    els.doneScore.textContent = formatScore(mine.score);
    els.doneMeta.textContent = [mine.puzzle && `Krillion ${cleanPuzzle(mine.puzzle)}`, spaceOut(mine.grid)].filter(Boolean).join('  ·  ');
  }
}

function hasSubmittedToday() {
  if (TEST_MODE) return false; // keep adding players
  return (state.todayScores || []).some((entry) => entry.uid === state.user?.uid);
}

function renderToday() {
  const now = nowMs();
  const closed = isDayClosed(state.today, now);
  const ranked = todayRanked();

  els.todayKicker.textContent = `Today · ${formatDay(state.today)}`;
  els.todayStatus.textContent = isDayFinal(state.today, now)
    ? 'Final results. The next dive opens at midnight.'
    : closed
      ? `Submissions closed at ${CUTOFF_LABEL}. Results in a moment…`
      : `Live standings. Submissions close at ${CUTOFF_LABEL} (${formatDuration(cutoffInstant(state.today) - now)} left).`;

  els.todayTable.hidden = ranked.length === 0;
  els.todayEmpty.hidden = ranked.length > 0;
  els.todayEmpty.textContent = state.todayScores === null ? 'Loading…' : 'No scores yet today. Be the first.';
  els.todayBody.replaceChildren(
    ...ranked.map((entry) =>
      el('tr', { className: entry.uid === state.user?.uid ? 'me' : '' },
        el('td', { className: 'rank' }, entry.points ? medal(entry.rank) : String(entry.rank)),
        el('td', { className: 'name' },
          entry.displayName,
          entry.puzzle ? el('span', { className: 'puzzle' }, cleanPuzzle(entry.puzzle)) : null,
          // On phones the dive log sits under the name instead of in its own column.
          entry.grid ? el('span', { className: 'grid-inline' }, spaceOut(entry.grid)) : null,
        ),
        el('td', { className: 'numeric' }, formatScore(entry.score)),
        el('td', { className: 'numeric points' }, entry.points ? `+${entry.points}` : '–'),
        el('td', { className: 'grid' }, spaceOut(entry.grid)),
      )
    )
  );
}

function renderOverall() {
  const fresh = tallyResults(closedDayResults(withTest(state.scores), nowMs()));
  const rows = rankPlayers(mergeTallies(state.standings?.players, fresh));

  els.overallTable.hidden = rows.length === 0;
  els.overallEmpty.hidden = rows.length > 0;
  els.overallEmpty.textContent = state.standingsLoaded && state.scoresLoaded
    ? `No finished days yet. Points land at ${CUTOFF_LABEL}.`
    : 'Loading…';
  els.overallStatus.textContent = rows.length
    ? `3 points for a win, 2 for second, 1 for third.\nTies share the place.\nToday counts from ${CUTOFF_LABEL}.`
    : '';

  els.overallHead.replaceChildren(
    el('tr', {},
      el('th', {}),
      el('th', {}, 'Player'),
      el('th', { className: 'numeric' }, 'Points'),
      ...CATEGORIES.map((category) =>
        el('th', { className: 'numeric category' }, `No. ${category.label}`)
      ),
    )
  );

  els.overallBody.replaceChildren(
    ...rows.map((row) =>
      el('tr', { className: row.uid === state.user?.uid ? 'me' : '' },
        el('td', { className: 'rank' }, row.rank <= 3 ? medal(row.rank) : String(row.rank)),
        el('td', { className: 'name' }, nameFor(row.uid, row.displayName)),
        el('td', { className: 'numeric points' }, String(row.points)),
        ...CATEGORIES.map((category) => {
          const count = row.counts?.[category.key] || 0;
          return el('td', { className: `numeric${count ? '' : ' muted'}` }, String(count));
        }),
      )
    )
  );
}

function renderHistory() {
  const throughDate = state.standings?.throughDate || NO_STANDINGS;
  const days = [
    ...closedDayResults(withTest(state.scores), nowMs()),
    ...state.results.filter((day) => day.date <= throughDate),
  ].sort((a, b) => b.date.localeCompare(a.date));

  els.historyEmpty.hidden = days.length > 0;
  els.historyList.replaceChildren(
    ...days.map((day) => {
      const winners = day.entries.filter((entry) => entry.rank === 1).map((entry) => nameFor(entry.uid, entry.displayName));
      return el('details', { className: 'day card' },
        el('summary', {},
          el('span', { className: 'day-date' }, formatDay(day.date)),
          el('span', { className: 'day-winner' }, winners.length ? `🥇 ${winners.join(' & ')}` : 'No scores'),
        ),
        el('ol', { className: 'day-list' },
          ...day.entries.map((entry) =>
            el('li', {},
              el('span', { className: 'rank' }, entry.points ? medal(entry.rank) : String(entry.rank)),
              el('span', { className: 'name' }, nameFor(entry.uid, entry.displayName)),
              el('span', { className: 'numeric' }, formatScore(entry.score)),
              el('span', { className: 'numeric points' }, entry.points ? `+${entry.points}` : ''),
            )
          )
        ),
      );
    })
  );
}

// ------------------------------------------------------------------ submit

/** Re-read the paste box and show what we understood from it. */
/** Take a pasted result. The only way text gets into the form. */
function acceptPaste(text) {
  if (!state.user || hasSubmittedToday() || isDayClosed(state.today, nowMs())) return;
  state.pastedText = String(text || '');
  els.pasteZone.textContent = state.pastedText;
  updateParsed();
}

function updateParsed() {
  const text = state.pastedText;
  const result = text.trim() ? parseResult(text) : null;

  state.parsed = result && !result.error ? result : null;
  els.submitButton.hidden = !state.parsed;
  els.submitButton.disabled = !state.parsed || state.saving;
  els.parsed.hidden = !state.parsed;
  els.pasteZone.classList.toggle('filled', Boolean(state.parsed));
  els.pasteZone.classList.toggle('invalid', Boolean(result?.error));
  els.submitHint.textContent = result?.error || '';

  if (state.parsed) {
    els.parsedScore.textContent = formatScore(state.parsed.score);
    els.parsedMeta.textContent = [state.parsed.puzzle && `Krillion ${state.parsed.puzzle}`, spaceOut(state.parsed.grid)]
      .filter(Boolean)
      .join('  ·  ');
  }
}

function clearForm() {
  state.pastedText = '';
  els.pasteZone.textContent = '';
  updateParsed();
}

async function onSubmit(event) {
  event.preventDefault();
  if (!state.parsed || state.saving) return;

  if (hasSubmittedToday()) {
    render();
    return;
  }

  if (isDayClosed(state.today, nowMs())) {
    showError(`Too late, submissions closed at ${CUTOFF_LABEL}.`);
    render();
    return;
  }

  if (TEST_MODE) {
    addTestScore(state.parsed);
    clearForm();
    showError('');
    render();
    return; // stay on Add Score, ready for the next paste
  }

  state.saving = true;
  els.submitButton.disabled = true;
  els.submitButton.textContent = 'Saving…';
  try {
    await submitScore({
      date: state.today,
      uid: state.user.uid,
      displayName: nameFor(state.user.uid, state.user.displayName),
      ...state.parsed,
    });
    clearForm();
    showError('');
    selectTab('daily');
  } catch (error) {
    console.error(error);
    showError(
      error.code === 'permission-denied'
        ? 'Couldn’t save that. You may have already submitted today, or submissions have closed.'
        : `Couldn’t save your score: ${error.message}`
    );
  } finally {
    state.saving = false;
    els.submitButton.textContent = 'Submit score';
    updateParsed();
    render();
  }
}

// The paste zone: paste in, nothing else. The paste itself is handled by the
// document-level listener below; everything else that would change the text
// (typing, deleting, dropping, autocorrect) is cancelled here.
els.pasteZone.addEventListener('beforeinput', (event) => event.preventDefault());
els.pasteZone.addEventListener('drop', (event) => event.preventDefault());
els.pasteZone.addEventListener('keydown', (event) => {
  const allowed = event.metaKey || event.ctrlKey || event.key === 'Tab' || event.key.startsWith('Arrow');
  if (!allowed) event.preventDefault();
});
els.seeStandings.addEventListener('click', () => selectTab('daily'));
els.form.addEventListener('submit', onSubmit);

els.pasteButton.addEventListener('click', async () => {
  try {
    acceptPaste(await navigator.clipboard.readText());
  } catch {
    // Permission denied or unsupported (e.g. Firefox): fall back to manual paste.
    els.pasteZone.focus();
    els.submitHint.textContent = 'Your browser blocked that. Long-press the box below (or Ctrl/⌘+V) instead.';
  }
});

// Paste anywhere on the page, not just in the box.
document.addEventListener('paste', (event) => {
  if (!state.user || els.form.hidden) return;
  const text = event.clipboardData?.getData('text');
  event.preventDefault(); // never let the browser insert it itself
  if (!text) return;
  selectTab('add');
  acceptPaste(text);
});

// ------------------------------------------------------------------- tabs

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
}

function selectTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }
  $('panel-add').hidden = name !== 'add';
  $('panel-daily').hidden = name !== 'daily';
  $('panel-overall').hidden = name !== 'overall';
  window.scrollTo(0, 0);
}

els.seeResults.addEventListener('click', () => selectTab('daily'));

// ----------------------------------------------------------- subscriptions

function onLoadError(error) {
  showError(`Couldn’t load scores: ${error.message}`);
  // Don't leave a loader spinning forever: show the page with what we have.
  if (state.todayScores === null) state.todayScores = [];
  state.scoresLoaded = state.standingsLoaded = true;
  render();
}

async function resubscribeScores() {
  state.unsubScores?.();
  const after = state.standings?.throughDate || NO_STANDINGS;
  state.unsubScores = await subscribeScoresAfter(after, (scores) => {
    state.scores = scores;
    state.scoresLoaded = true;
    render();
  }, onLoadError);
}

async function resubscribeToday() {
  state.unsubToday?.();
  state.todayScores = null;
  const date = state.today;
  state.unsubToday = await subscribeScoresOn(date, (scores) => {
    if (date !== state.today) return; // midnight passed while this was in flight
    state.todayScores = scores;
    render();
  }, onLoadError);
}

async function refreshResults() {
  try {
    state.results = await fetchResults();
    renderHistory();
  } catch (error) {
    console.error('Could not load history', error);
  }
}

let started = false;

function startData() {
  if (started) return;
  started = true;

  // All of these start at once; none waits for another.
  resubscribeToday();

  let profileChecked = false;
  subscribeUsers((users) => {
    state.users = users;
    render();
    updateWho();
    // Create/refresh the profile in the background, using the copy we just
    // received rather than a separate read. Never blocks rendering.
    if (!profileChecked) {
      profileChecked = true;
      ensureProfile(state.user, users[state.user.uid] || null).catch((error) =>
        console.error('Could not save profile', error)
      );
    }
  }, onLoadError);

  let lastThrough;
  subscribeStandings((standings) => {
    state.standings = standings;
    state.standingsLoaded = true;
    const through = standings?.throughDate || NO_STANDINGS;
    if (through !== lastThrough) {
      lastThrough = through;
      resubscribeScores();
      refreshResults();
    }
    render();
  }, onLoadError);

  // Tick: countdown, 18:00 lock, 18:01 results, midnight rollover.
  setInterval(() => {
    const today = londonDate();
    if (today !== state.today) {
      state.today = today;
      clearForm();
      resubscribeToday();
    }
    render();
  }, 15_000);
}

// ------------------------------------------------------------------- auth

function updateWho() {
  if (!state.user) return;
  els.whoName.textContent = nameFor(state.user.uid, state.user.displayName);
  if (state.user.photoURL) els.whoAvatar.src = state.user.photoURL;
  els.whoAvatar.hidden = !state.user.photoURL;
}

els.signinButton.addEventListener('click', async () => {
  try {
    await signIn();
  } catch (error) {
    if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
      showError(`Sign-in failed: ${error.message}`);
    }
  }
});

els.signOut.addEventListener('click', () => signOut().then(() => location.reload()));

els.whoName.addEventListener('click', async () => {
  const current = nameFor(state.user.uid, state.user.displayName);
  const next = prompt('The name everyone sees on the leaderboard:', current);
  const trimmed = next?.trim().slice(0, 30);
  if (!trimmed || trimmed === current) return;
  try {
    await setNickname(state.user.uid, trimmed);
  } catch (error) {
    showError(`Couldn’t change your name: ${error.message}`);
  }
});

// --------------------------------------------------------------- bootstrap

// Always open on Add Score.
selectTab('add');

if (!isConfigured) {
  els.boot.hidden = true;
  showError('Firebase isn’t configured yet. Paste your project config into assets/firebase.js (see README).');
} else {
  watchAuth((user) => {
    state.user = user;
    els.boot.hidden = true;
    els.signinView.hidden = Boolean(user);
    els.appView.hidden = !user;
    els.who.hidden = !user;
    els.tabs.hidden = !user;
    if (!user) return;

    updateWho();
    startData();
    render();
  }).catch((error) => {
    els.boot.hidden = true;
    showError(`Couldn’t start: ${error.message}`);
  });
}
