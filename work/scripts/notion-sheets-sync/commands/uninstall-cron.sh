#!/bin/bash
# Remove the cron entry installed by install-cron.sh. Other crontab lines are
# preserved. Safe to run even when no entry exists.

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
tool_dir="$(cd "$script_dir/.." && pwd)"

# Dedupe by tool_dir so any legacy location (e.g. older run-sync.sh path) is also cleared.
remaining="$(crontab -l 2>/dev/null | grep -vF "$tool_dir" || true)"

if [ -n "$remaining" ]; then
  printf '%s\n' "$remaining" | crontab -
else
  crontab -r 2>/dev/null || true
fi

echo "Removed cron entries pointing to $tool_dir"
