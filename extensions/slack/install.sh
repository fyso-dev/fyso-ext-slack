#!/usr/bin/env bash
set -euo pipefail
root="${FYSO_ROOT:-$(pwd)}"
runtime="$root/.data/ext/slack"
source_dir="$root/extensions/slack"
mkdir -p "$runtime"
cp "$source_dir/package.json" "$source_dir/package-lock.json" "$runtime/"
unset SLACK_BOT_TOKEN SLACK_APP_TOKEN
export npm_config_cache="$runtime/npm-cache"
npm ci --prefix "$runtime" --omit=dev --ignore-scripts --no-audit --no-fund >&2
