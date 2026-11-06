#!/bin/sh
# Starts Claude with only the ChainPe wallet, in an empty folder, so what it knows
# about the agents comes from their listings and on-chain ratings, not this repo's code.
set -e
here=$(cd "$(dirname "$0")" && pwd)
set -a; . "$here/../../.env"; set +a
unset CHAINPE_CONFIG
dir=$(mktemp -d)
sed "s#\.\./\.\./packages#$here/../../packages#" "$here/mcp.json" > "$dir/mcp.json"
cd "$dir"
exec claude --mcp-config mcp.json --strict-mcp-config \
  --disallowedTools "Bash,Read,Edit,Write,Grep,Glob,NotebookEdit,WebFetch,WebSearch,Agent,Skill" "$@"
