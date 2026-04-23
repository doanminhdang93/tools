#!/bin/bash
# Wrapper so cron can invoke the sync with nvm's node on PATH.
# Exit code propagates so cron failure reports are meaningful.

set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")/.."
# --cron reads $SYNC_CRON_TAB from .token.env:
#   "all" (or unset) → sync every tab; "<member>" → sync only that member's tab.
npm run sync -- --cron
