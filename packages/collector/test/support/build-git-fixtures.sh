#!/bin/bash
# Deterministic git fixtures for the git.ts characterization snapshot.
# Every commit pins author+committer name/email/date, so every sha is reproducible
# and the snapshot is byte-stable across runs. Built ONCE and reused by both the
# pre-split recording and the post-split replay.
set -euo pipefail

ROOT="${1:?usage: build-fixtures.sh <root>}"
rm -rf "$ROOT"
mkdir -p "$ROOT"

export GIT_AUTHOR_NAME="Fix Ture"
export GIT_AUTHOR_EMAIL="fix@example.invalid"
export GIT_COMMITTER_NAME="Fix Ture"
export GIT_COMMITTER_EMAIL="fix@example.invalid"

# Commit dates are pinned ABSOLUTE, but `git log --since=N days ago` is relative to
# now. So the fixture uses dates computed from a pinned base that is far inside the
# 7-day default window (2 days back) or far outside it (400 days back), never near a
# boundary. Recomputed at BUILD time only; both snapshot runs read the same repo.
BASE_EPOCH=$(( $(date +%s) - 2*86400 ))
OLD_EPOCH=$(( $(date +%s) - 400*86400 ))

commit_at() { # commit_at <epoch> <message>
  GIT_AUTHOR_DATE="$1 +0000" GIT_COMMITTER_DATE="$1 +0000" \
    git commit -q --no-gpg-sign -m "$2"
}

newrepo() {
  local d="$ROOT/$1"
  mkdir -p "$d"
  git -C "$d" init -q -b main
  git -C "$d" config user.name "Fix Ture"
  git -C "$d" config user.email "fix@example.invalid"
  git -C "$d" config commit.gpgsign false
  echo "$d"
}

# ── 1. not a repo at all ────────────────────────────────────────────────────
mkdir -p "$ROOT/plain-dir"
printf 'hello\n' > "$ROOT/plain-dir/file.txt"

# ── 2. clean repo with a remote ──────────────────────────────────────────────
d=$(newrepo clean)
cd "$d"
git remote add origin https://example.invalid/owner/clean.git
printf 'line1\nline2\nline3\n' > a.ts
printf 'x\n' > package-lock.json
mkdir -p dist && printf 'bundled\n' > dist/out.js
git add -A && commit_at "$BASE_EPOCH" "root commit"
printf 'line1\nline2\nline3\nline4\nline5\n' > a.ts
printf 'y\nz\n' > package-lock.json
printf 'gen\n' > thing.generated.ts
git add -A && commit_at "$((BASE_EPOCH + 3600))" "second commit"
printf 'new file\ncontent\n' > b.ts
git add -A && commit_at "$((BASE_EPOCH + 7200))" "third commit"

# ── 3. no remote ────────────────────────────────────────────────────────────
d=$(newrepo no-remote)
cd "$d"
printf 'a\n' > a.ts
git add -A && commit_at "$BASE_EPOCH" "root commit"

# ── 4. dirty working tree (uncommitted changes) ──────────────────────────────
d=$(newrepo dirty)
cd "$d"
git remote add origin https://example.invalid/owner/dirty.git
printf 'one\ntwo\nthree\nfour\n' > tracked.ts
printf 'lock\n' > yarn.lock
git add -A && commit_at "$BASE_EPOCH" "root commit"
# tracked modification: 2 added, 1 deleted vs HEAD
printf 'one\nTWO-CHANGED\nthree\nfour\nfive\n' > tracked.ts
# ignored-glob modification
printf 'lock\nlock2\nlock3\n' > yarn.lock
# untracked files, one ignored by glob
printf 'untracked\n' > untracked.ts
printf 'snap\n' > thing.snap

# ── 5. detached HEAD ────────────────────────────────────────────────────────
d=$(newrepo detached)
cd "$d"
git remote add origin https://example.invalid/owner/detached.git
printf 'a\n' > a.ts
git add -A && commit_at "$BASE_EPOCH" "root commit"
printf 'b\n' > b.ts
git add -A && commit_at "$((BASE_EPOCH + 60))" "second"
git checkout -q --detach HEAD

# ── 5b. detached AND dirty, and dirty AND no-remote ─────────────────────────
# gitContext returns ONE value from an ordered chain of checks, so a repo in exactly
# one state cannot pin the ORDER of those checks — swapping two of them stays
# invisible. These two repos satisfy two conditions at once, which makes the
# precedence itself observable: detached must win over dirty, and dirty over
# no-remote.
d=$(newrepo detached-dirty)
cd "$d"
git remote add origin https://example.invalid/owner/detached-dirty.git
printf 'a\n' > a.ts
git add -A && commit_at "$BASE_EPOCH" "root commit"
printf 'b\n' > b.ts
git add -A && commit_at "$((BASE_EPOCH + 60))" "second"
git checkout -q --detach HEAD
printf 'a\nuncommitted\n' > a.ts
printf 'untracked\n' > u.ts

d=$(newrepo dirty-no-remote)
cd "$d"
printf 'one\ntwo\n' > tracked.ts
git add -A && commit_at "$BASE_EPOCH" "root commit"
printf 'one\ntwo\nthree\n' > tracked.ts

# ── 6. empty repo (no commits) ──────────────────────────────────────────────
newrepo empty > /dev/null

# ── 7. history repo: merges, renames, binary, old commits, multiple files ────
d=$(newrepo history)
cd "$d"
git remote add origin https://example.invalid/owner/history.git
# An OLD commit outside the momentum window and outside a short --since.
printf 'ancient\n' > ancient.ts
git add -A && commit_at "$OLD_EPOCH" "ancient commit"
printf 'l1\nl2\nl3\nl4\nl5\n' > src.ts
printf 'lock\n' > pnpm-lock.yaml
git add -A && commit_at "$BASE_EPOCH" "add src"
# rename with content change (exercises resolveNumstatPath through commitsSince)
mkdir -p nested
git mv src.ts nested/renamed.ts
printf 'l1\nl2\nl3\nl4\nl5\nl6\nl7\n' > nested/renamed.ts
git add -A && commit_at "$((BASE_EPOCH + 100))" "rename and grow"
# a binary file (numstat reports "-" markers)
printf '\x00\x01\x02\x03binary\x00' > blob.bin
git add -A && commit_at "$((BASE_EPOCH + 200))" "add binary"
# a real merge commit, so --no-merges has something to exclude
git checkout -q -b side
printf 'side1\nside2\n' > side.ts
git add -A && commit_at "$((BASE_EPOCH + 300))" "side work"
git checkout -q main
printf 'main1\n' > mainonly.ts
git add -A && commit_at "$((BASE_EPOCH + 400))" "main work"
GIT_AUTHOR_DATE="$((BASE_EPOCH + 500)) +0000" GIT_COMMITTER_DATE="$((BASE_EPOCH + 500)) +0000" \
  git merge -q --no-ff --no-gpg-sign -m "merge side" side
# a pure deletion (0 added lines -> dropped by commitsSince)
git rm -q ancient.ts
git add -A && commit_at "$((BASE_EPOCH + 600))" "delete ancient"

# ── 8. survival repo: authored lines that survive, and lines overwritten ─────
d=$(newrepo survival)
cd "$d"
git remote add origin https://example.invalid/owner/survival.git
printf 'base1\nbase2\n' > keep.ts
git add -A && commit_at "$BASE_EPOCH" "root commit"
# C1 authors 3 lines in keep.ts that will SURVIVE
printf 'base1\nbase2\nsurv1\nsurv2\nsurv3\n' > keep.ts
git add -A && commit_at "$((BASE_EPOCH + 100))" "author surviving lines"
# C2 authors 2 lines in gone.ts, then a later commit overwrites them entirely
printf 'dead1\ndead2\n' > gone.ts
git add -A && commit_at "$((BASE_EPOCH + 200))" "author lines later overwritten"
printf 'replaced1\nreplaced2\n' > gone.ts
git add -A && commit_at "$((BASE_EPOCH + 300))" "overwrite them"
# C3 authors lines in a file that is later DELETED (filesGoneFromTip)
printf 'vanish1\nvanish2\n' > vanish.ts
git add -A && commit_at "$((BASE_EPOCH + 400))" "author lines in doomed file"
git rm -q vanish.ts
git add -A && commit_at "$((BASE_EPOCH + 500))" "delete doomed file"
# an orphan commit reachable from NO branch (the unreachable fate)
git checkout -q --detach HEAD
printf 'orphan\n' > orphan.ts
git add -A && commit_at "$((BASE_EPOCH + 600))" "orphan commit"
git rev-parse HEAD > "$ROOT/survival-orphan-sha"
git checkout -q main

# Record the survival shas the harness needs, by message (deterministic).
cd "$ROOT/survival"
for msg in "author surviving lines" "author lines later overwritten" "author lines in doomed file"; do
  git log --format='%H %s' | grep " $msg$" | cut -d' ' -f1
done > "$ROOT/survival-shas"

echo "fixtures built at $ROOT"
