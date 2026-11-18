#!/usr/bin/env python3
"""Static wiring checks for a build-step-free site (adapted from quiz-site).

Catches, without a browser:
  1. getElementById('typo')  -> null, then a TypeError on first use
  2. import { notExported }  -> module-level SyntaxError, whole script dead
  3. broken relative links in index.html
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "index.html"
SCRIPTS = [
    "assets/app.js",
    "assets/firebase.js",
    "assets/dates.js",
    "assets/scoring.js",
    "assets/result.js",
    "assets/names.js",
    "scripts/nightly-results.mjs",
]

problems = []


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as handle:
        return handle.read()


def check_dom_ids():
    js = read("assets/app.js")
    html = read(PAGE)
    declared = set(re.findall(r"""\bid=["']([^"']+)["']""", html))
    used = set(re.findall(r"""(?:\$|getElementById)\(["']([^"']+)["']\)""", js))
    for missing in sorted(used - declared):
        problems.append(f"assets/app.js: id '{missing}' not found in {PAGE}")
    for unused in sorted(declared - used):
        print(f"  note: id '{unused}' in {PAGE} is never read by app.js")


def check_named_imports():
    for script in SCRIPTS:
        js = read(script)
        for names, target in re.findall(r"import\s*\{([^}]*)\}\s*from\s*['\"](\.[^'\"]+)['\"]", js):
            target_rel = os.path.normpath(os.path.join(os.path.dirname(script), target))
            if not os.path.exists(os.path.join(ROOT, target_rel)):
                problems.append(f"{script}: imports missing file {target_rel}")
                continue
            source = read(target_rel)
            for name in names.split(","):
                name = name.strip().split(" as ")[0].strip()
                if not name:
                    continue
                exported = re.search(
                    rf"export\s+(?:async\s+)?(?:const|function\*?|let|var|class)\s+{re.escape(name)}\b",
                    source,
                ) or re.search(rf"export\s*\{{[^}}]*\b{re.escape(name)}\b", source)
                if not exported:
                    problems.append(f"{script}: imports '{name}' from {target_rel}, which does not export it")


def check_asset_links():
    html = read(PAGE)
    for attr in re.findall(r"""(?:src|href)=["'](?!https?:|data:|#|mailto:)([^"']+)["']""", html):
        if not os.path.exists(os.path.join(ROOT, attr)):
            problems.append(f"{PAGE}: link target not found -> {attr}")


check_dom_ids()
check_named_imports()
check_asset_links()

if problems:
    print()
    for problem in problems:
        print(f"  FAIL {problem}")
    print(f"\n{len(problems)} wiring problem(s)")
    sys.exit(1)

print("Wiring OK: DOM ids, named imports and relative links all resolve.")
