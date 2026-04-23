#!/bin/bash
# Wrapper so cron can invoke `npm run sync -- --all` with nvm's node on PATH.
# Exit code propagates so cron failure reports are meaningful.

set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")"
npm run sync -- --all
