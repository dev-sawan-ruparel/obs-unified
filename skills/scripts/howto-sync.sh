#!/usr/bin/env bash
# The skill bundle ships its own copy of docs/howto/instrument-react-hono.md.
# docs/howto is the source; relative repo links are rewritten to absolute
# GitHub URLs because they do not resolve inside the .skill bundle.
#
#   howto-sync.sh --write   regenerate the skill copy
#   howto-sync.sh --check   fail if the skill copy is out of date (default)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/docs/howto/instrument-react-hono.md"
DST="$ROOT/skills/instrument-obs-unified/references/instrument-react-hono.md"
BASE="https://github.com/dev-sawan-ruparel/obs-unified/blob/main"

render() {
	sed \
		-e "s#](\.\./\.\./#]($BASE/#g" \
		-e "s#](\.\./recipes/#]($BASE/docs/recipes/#g" \
		-e "s#](\.\./spec/#]($BASE/docs/spec/#g" \
		-e "s#](\.\./archive/#]($BASE/docs/archive/#g" \
		"$SRC"
}

case "${1:---check}" in
--write)
	render >"$DST"
	echo "wrote $DST"
	;;
--check)
	if ! render | cmp -s - "$DST"; then
		echo "ERROR: $DST is out of sync with docs/howto/instrument-react-hono.md" >&2
		echo "Run: skills/scripts/howto-sync.sh --write" >&2
		exit 1
	fi
	;;
*)
	echo "usage: $0 [--write|--check]" >&2
	exit 2
	;;
esac
