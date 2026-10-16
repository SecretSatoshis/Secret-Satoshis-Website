#!/bin/sh

# Vercel runs this from agent21: 0 skips the build; 1 continues it.
# Keep the command in vercel.json below its 256-character limit.
# A redeploy of the commit already deployed is deliberate, such as applying a
# changed environment variable, so it builds; a push always brings a new commit.
if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ] &&
  [ "$VERCEL_GIT_PREVIOUS_SHA" != "$VERCEL_GIT_COMMIT_SHA" ] &&
  git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA^{commit}" 2>/dev/null &&
  git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- \
    . \
    ../css/fonts.css \
    ../css/agent21-face.css \
    ../js/agent21-face.js \
    ../js/agent21-face.d.ts \
    ../assets/fonts \
    ../favicon.ico; then
  exit 0
else
  # Build when the previous commit is missing or the comparison fails.
  exit 1
fi
