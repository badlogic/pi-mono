#!/bin/sh
# Preserve the caller's working directory; resolve application files from this script.
set -eu
web_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v node >/dev/null 2>&1; then
  exec node "$web_dir/start.mjs" "$@"
fi
printf '%s\n' 'Node.js 22.19+ is required. Install Node.js and run this command again.' >&2
exit 1
