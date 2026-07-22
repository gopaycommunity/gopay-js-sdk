#!/usr/bin/env bash
# Preview whether merging the current branch would trigger a semantic-release
# version bump for the given workspace. Usage: release-preview.sh <package-name> [--gate]
#
# Uses `yarn workspace <pkg> exec semantic-release` (the pinned devDependency),
# NOT `yarn dlx semantic-release` (always fetches latest) — otherwise an upstream
# wording change to the "no relevant changes" log line would silently break the
# --gate check below without any error.
#
# --branches "$BITBUCKET_BRANCH" overrides the configured 'master' release branch
# so the dry-run analyzes THIS branch's own commits instead of always reporting
# "wrong branch, skipping".
set -uo pipefail

PKG="$1"
GATE="${2:-}"

OUTPUT=$(yarn workspace "$PKG" exec semantic-release --dry-run --no-ci --branches "$BITBUCKET_BRANCH" 2>&1)
EXIT_CODE=$?
echo "$OUTPUT"

if [ "$EXIT_CODE" -ne 0 ]; then
  exit "$EXIT_CODE"
fi

if [ "$GATE" = "--gate" ] && echo "$OUTPUT" | grep -q "no relevant changes"; then
  echo ""
  echo "No release-worthy commit (fix/feat/BREAKING CHANGE) found — $PKG would not get a new version if this PR merges as-is."
  echo "Add a fix:/feat: commit (or a BREAKING CHANGE: footer) if this PR is meant to ship a release."
  exit 1
fi
