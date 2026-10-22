#!/bin/bash
# Readies a Claude Code cloud session: the packages the checks and journeys
# need, and the browser they drive. Runs only in the cloud; on someone's own
# computer it does nothing.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# The same lockfile as CI; never adds or upgrades a package.
pnpm install --frozen-lockfile

# The cloud cannot download Playwright's own browser, so the journeys drive
# the Chromium already installed here (older than CI's; docs/開発と運用/開発の手順.md).
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x /opt/pw-browsers/chromium ] &&
  [ -z "${BOOK_TOWN_CHROME:-}" ]; then
  echo 'export BOOK_TOWN_CHROME=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi
