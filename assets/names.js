// The names shown on the boards. Pure module so it can be tested in node.
//
// Everyone appears under their nickname, which defaults to their Google first
// name. When two or more people would show the same name, each gets just
// enough of their surname (taken from their full Google name) to tell them
// apart:
//
//   Ciaran Murphy + Ciaran O'Neill   ->  "Ciaran M."   / "Ciaran O."
//   Ciaran McCann + Ciaran Martin    ->  "Ciaran Mc."  / "Ciaran Ma."
//   Ciaran Murphy + Dave Smith       ->  "Ciaran"      / "Dave"
//
// Worked out every time the page loads, so it fixes itself as people join or
// rename themselves; nothing extra is stored.

const firstWord = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** Surname = last word of the full Google name ('' if there's only one word). */
function surnameOf(googleName) {
  const words = String(googleName || '').trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? words[words.length - 1] : '';
}

/** The name someone chose (or their Google first name), before any clash fixing. */
export function baseName(user) {
  return String(user?.nickname || firstWord(user?.googleName) || 'Someone').trim();
}

/** The first `letters` of a surname: "Mc." while shortened, "McCann" once whole. */
function surnamePart(surname, letters) {
  return letters < surname.length ? `${surname.slice(0, letters)}.` : surname;
}

/**
 * { uid: { nickname, googleName } } -> { uid: 'Name shown on the boards' }
 */
export function displayNames(users = {}) {
  const result = {};
  const groups = new Map(); // lower-cased base name -> [uid]

  for (const [uid, user] of Object.entries(users)) {
    result[uid] = baseName(user);
    const key = result[uid].toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(uid);
  }

  for (const uids of groups.values()) {
    if (uids.length < 2) continue;

    const surnames = Object.fromEntries(uids.map((uid) => [uid, surnameOf(users[uid].googleName)]));
    const longest = Math.max(...Object.values(surnames).map((surname) => surname.length));

    // Add surname letters one at a time until everyone in the clash is distinct
    // (or we run out of letters: two identical full names stay identical).
    for (let letters = 1; letters <= Math.max(longest, 1); letters += 1) {
      const labels = uids.map((uid) => {
        const surname = surnames[uid];
        return surname ? `${baseName(users[uid])} ${surnamePart(surname, letters)}` : baseName(users[uid]);
      });
      uids.forEach((uid, index) => { result[uid] = labels[index]; });
      // Ignore the trailing dot: "Jo Li" vs "Jo Li." isn't a real difference.
      const keys = labels.map((label) => label.toLowerCase().replace(/\.$/, ''));
      if (new Set(keys).size === keys.length) break;
    }
  }

  return result;
}
