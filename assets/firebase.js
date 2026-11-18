// Firebase wiring: Google sign-in + Firestore. Same pattern as quiz-site: the
// SDK is imported from Google's CDN, so there's no build step.

// ============================================================================
// PASTE YOUR FIREBASE CONFIG HERE
// ============================================================================
// Firebase console -> Project settings -> Your apps -> Web app -> SDK setup.
//
// These values are MEANT to be public; Firebase web keys identify a project,
// they don't authorise access. Safety comes from firestore.rules plus Google
// sign-in, not from hiding this. Committing it is correct.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDEVgltVnyLyMnMA8hbASBrjQdleFaCrfc",
  authDomain: "krillion-leaderboard-c86e7.firebaseapp.com",
  projectId: "krillion-leaderboard-c86e7",
  storageBucket: "krillion-leaderboard-c86e7.firebasestorage.app",
  messagingSenderId: "219024197264",
  appId: "1:219024197264:web:55f3fd73b3d76ce45ffa15"

};

// Pinned deliberately (same version quiz-site uses). index.html modulepreloads
// these same three URLs so they download in parallel with the page; if you
// bump the version, bump it there too.
const SDK_VERSION = '12.18.0';
const SDK = (name) => `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-${name}.js`;

export const isConfigured = Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);

let sdkPromise = null;

function loadSdk() {
  sdkPromise ||= (async () => {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(SDK('app')),
      import(SDK('auth')),
      import(SDK('firestore')),
    ]);
    const app = initializeApp(FIREBASE_CONFIG);

    // Keep a copy of the data in the browser (IndexedDB). Repeat visits draw
    // straight from it, then update live, and Firestore bills fewer reads.
    // Falls back to memory-only if the browser refuses (e.g. private mode).
    let db;
    try {
      db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch (error) {
      console.warn('Offline cache unavailable, continuing without it.', error);
      db = fs.getFirestore(app);
    }

    return { auth, fs, authInstance: auth.getAuth(app), db };
  })();
  return sdkPromise;
}

// ------------------------------------------------------------------- auth

/** Calls back with a Firebase user, or null when signed out. */
export async function watchAuth(callback) {
  const { auth, authInstance } = await loadSdk();
  return auth.onAuthStateChanged(authInstance, callback);
}

export async function signIn() {
  const { auth, authInstance } = await loadSdk();
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await auth.signInWithPopup(authInstance, provider);
}

export async function signOut() {
  const { auth, authInstance } = await loadSdk();
  await auth.signOut(authInstance);
}

// -------------------------------------------------------------- firestore

/** Firestore Timestamp -> ms. Pending server timestamps resolve to "now". */
function toMillis(value) {
  if (!value) return Date.now();
  if (typeof value.toMillis === 'function') return value.toMillis();
  return Number(value);
}

function snapshotRows(snapshot) {
  return snapshot.docs.map((entry) => ({
    id: entry.id,
    // 'estimate' fills our own just-written server timestamps locally, so the
    // board updates instantly instead of showing a blank time.
    ...entry.data({ serverTimestamps: 'estimate' }),
  }));
}

/**
 * Create the profile doc on first sign-in, and refresh the Google name/photo
 * if they've changed. Writes nothing on an ordinary visit. Never awaited by
 * startup, so it can't slow the page down.
 */
export async function ensureProfile(user, knownProfile) {
  const { fs, db } = await loadSdk();
  const ref = fs.doc(db, 'users', user.uid);
  const existing = knownProfile ?? (await fs.getDoc(ref)).data();

  const googleName = user.displayName || '';
  const photoURL = user.photoURL || '';
  if (existing && existing.googleName === googleName && existing.photoURL === photoURL) return;

  await fs.setDoc(
    ref,
    {
      googleName,
      photoURL,
      ...(existing?.nickname ? {} : { nickname: (googleName || 'Player').split(' ')[0] }),
    },
    { merge: true }
  );
}

export async function setNickname(uid, nickname) {
  const { fs, db } = await loadSdk();
  await fs.setDoc(fs.doc(db, 'users', uid), { nickname }, { merge: true });
}

function subscribe(refOrQuery, onRows, onError, map = (row) => row) {
  return loadSdk().then(({ fs }) =>
    fs.onSnapshot(
      refOrQuery,
      (snapshot) => onRows(snapshotRows(snapshot).map(map)),
      (error) => {
        console.error('Firestore subscription failed.', error);
        onError?.(error);
      }
    )
  );
}

/** All profiles: { uid: { nickname, photoURL, googleName } } */
export async function subscribeUsers(onUsers, onError) {
  const { fs, db } = await loadSdk();
  return subscribe(fs.collection(db, 'users'), (rows) => {
    onUsers(Object.fromEntries(rows.map((row) => [row.id, row])));
  }, onError);
}

/** Raw scores for one date. */
export async function subscribeScoresOn(date, onScores, onError) {
  const { fs, db } = await loadSdk();
  const q = fs.query(fs.collection(db, 'scores'), fs.where('date', '==', date));
  return subscribe(q, onScores, onError, (row) => ({ ...row, updatedAt: toMillis(row.updatedAt) }));
}

/** Raw scores for every date after `afterDate` (exclusive). */
export async function subscribeScoresAfter(afterDate, onScores, onError) {
  const { fs, db } = await loadSdk();
  const q = fs.query(fs.collection(db, 'scores'), fs.where('date', '>', afterDate));
  return subscribe(q, onScores, onError, (row) => ({ ...row, updatedAt: toMillis(row.updatedAt) }));
}

/** The job-maintained overall totals. Missing doc -> null. */
export async function subscribeStandings(onStandings, onError) {
  const { fs, db } = await loadSdk();
  return fs.onSnapshot(
    fs.doc(db, 'standings', 'overall'),
    (snapshot) => onStandings(snapshot.exists() ? snapshot.data() : null),
    (error) => {
      console.error('Standings subscription failed.', error);
      onError?.(error);
    }
  );
}

/** Finalised days written by the job, newest first. */
export async function fetchResults(max = 60) {
  const { fs, db } = await loadSdk();
  const q = fs.query(fs.collection(db, 'results'), fs.orderBy('date', 'desc'), fs.limit(max));
  const snapshot = await fs.getDocs(q);
  return snapshot.docs.map((entry) => entry.data());
}

/** Save today's result. One doc per person per day; the rules refuse a second write. */
export async function submitScore({ date, uid, displayName, score, puzzle, grid }) {
  const { fs, db } = await loadSdk();
  await fs.setDoc(fs.doc(db, 'scores', `${date}_${uid}`), {
    date,
    uid,
    displayName,
    score,
    puzzle,
    grid,
    updatedAt: fs.serverTimestamp(),
  });
}
