#!/usr/bin/env bash
set -euo pipefail
exec bash extensions/slack/runtime.sh tools.cjs check
