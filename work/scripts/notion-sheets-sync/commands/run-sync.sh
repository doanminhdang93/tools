#!/bin/bash
# Wrapper so cron can invoke the sync with nvm's node on PATH.
# Exit code propagates so cron failure reports are meaningful.

set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")/.."
# --cron resolves to $SYNC_CRON_TAB from .token.env (single-user install),
# or falls back to --all when the env var is unset (central runner install).
npm run sync -- --cron
