#!/bin/bash
# Install an hourly cron entry for this tool. Idempotent — re-running replaces
# any existing entry that points anywhere inside this tool's folder (so moving
# run-sync.sh between locations cleans up automatically).

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
tool_dir="$(cd "$script_dir/.." && pwd)"
run_script="$script_dir/run-sync.sh"
log_file="$tool_dir/sync.log"
cron_schedule="0 * * * *"
cron_line="$cron_schedule $run_script >> $log_file 2>&1"

if [ ! -f "$run_script" ]; then
  echo "error: $run_script not found" >&2
  exit 1
fi

chmod +x "$run_script"

# Dedupe by tool_dir so migrating run-sync.sh between locations leaves no stale line.
existing="$(crontab -l 2>/dev/null | grep -vF "$tool_dir" || true)"

{
  [ -n "$existing" ] && printf '%s\n' "$existing"
  printf '%s\n' "$cron_line"
} | crontab -

echo "Installed hourly cron:"
echo "  $cron_line"
echo
echo "Verify with: crontab -l"
echo "Logs:        tail -f $log_file"
