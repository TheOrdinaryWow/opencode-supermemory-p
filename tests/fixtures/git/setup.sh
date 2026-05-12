#!/usr/bin/env bash
#
# Reproducible local git fixture.
#
# Usage:
#   bash tests/fixtures/git/setup.sh            # set up in $PWD
#   bash tests/fixtures/git/setup.sh /tmp/foo   # set up in given dir
#
# Idempotent: safe to run repeatedly. Always exits 0 on success.
# Pins user.email + user.name so tag-derivation logic produces stable
# hashes regardless of the host machine.

set -euo pipefail

TARGET="${1:-$PWD}"
mkdir -p "$TARGET"
cd "$TARGET"

# Initialise a repo if one is not already present. Suppress noise.
if [ ! -d .git ]; then
  git init -q -b main . >/dev/null 2>&1
fi

# Pin identity for this repo only — never touch the global config.
git config user.email "test@example.com"
git config user.name  "Test User"

# Disable commit signing for fixtures (CI/local machines often have GPG
# signing enabled globally which would block --allow-empty commits).
git config commit.gpgsign false

# Anchor the repo with an empty commit so subsequent commands that need
# HEAD (log, rev-parse) work. Tolerate the case where one already exists.
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git commit --allow-empty -q -m "initial commit"
fi

exit 0
