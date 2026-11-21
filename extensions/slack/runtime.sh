#!/usr/bin/env bash
set -euo pipefail
root="${FYSO_ROOT:-$(pwd)}"
runtime="$root/.data/ext/slack"
export NODE_PATH="$runtime/node_modules"
script="$1"
shift
exec node "$root/extensions/slack/$script" "$@"
