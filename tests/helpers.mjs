// Tiny assertion helper, same spirit as quiz-site's createChecker.
export function createChecker(suite) {
  let passed = 0;
  const failures = [];

  function check(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) passed += 1;
    else failures.push(`${label}\n      expected ${e}\n      got      ${a}`);
  }

  function report() {
    for (const failure of failures) console.log(`  FAIL ${failure}`);
    console.log(`${suite}: ${passed} passed, ${failures.length} failed`);
    if (failures.length) process.exit(1);
  }

  return { check, report };
}
