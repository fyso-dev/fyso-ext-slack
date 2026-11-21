#!/usr/bin/env bash
set -euo pipefail
# Dagu forwards the project's SOPS key path under this framework variable.
if [ -z "${MISE_SOPS_AGE_KEY_FILE:-}" ] && [ -z "${SOPS_AGE_KEY_FILE:-}" ] && [ -n "${FYSO_COMPOSIO_AGE_KEY_FILE:-}" ]; then
  export MISE_SOPS_AGE_KEY_FILE="$FYSO_COMPOSIO_AGE_KEY_FILE"
fi
# The extension gate checks both tokens before running. A missing token has its own UI state.
if mise exec -- node -e 'process.exit(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN ? 0 : 2)'; then
  exec framework/scripts/run-ext.sh slack -- bash extensions/slack/runtime.sh manage.cjs "${SLACK_REQUEST_B64:-}"
else
  result=$?
  if [ "$result" -eq 2 ]; then
    printf '%s\n' '{"connection":"token_missing"}'
  else
    printf '%s\n' '{"error":"operation_failed"}'
  fi
fi
