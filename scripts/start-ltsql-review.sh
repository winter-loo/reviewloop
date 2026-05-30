#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

default_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
default_ip=${default_ip:-127.0.0.1}

export LTSQL_REVIEW_HOME="${LTSQL_REVIEW_HOME:-/data/ludd50155/.ltsql-review}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-2067}"
export LTSQL_REVIEW_BASE_URL="${LTSQL_REVIEW_BASE_URL:-http://${default_ip}:${PORT}}"

mkdir -p "$LTSQL_REVIEW_HOME"

cat <<INFO
Starting LTSQL Review Platform
  app:  $script_dir
  home: $LTSQL_REVIEW_HOME
  url:  $LTSQL_REVIEW_BASE_URL
  bind: $HOST:$PORT
INFO

exec node "$script_dir/build"
