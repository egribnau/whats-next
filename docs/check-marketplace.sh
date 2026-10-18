#!/bin/sh
# What's Next names the marketplace it is published in once, as MARKETPLACE
# in hooks/forge.ts, for when the engine does not say which one it came from.
# That name must be the one .claude-plugin/marketplace.json gives, and no
# other file of the mod's code may spell it out, but for the /config keys
# hooks/register.tsx saves a choice under (each written out, as the
# directory asks). Fails, naming what is wrong.
# The test sandbox cannot read the marketplace file, so this check lives here.
set -eu
root="$(dirname "$0")/.."
hooks="$root/hooks"

manifest="$(jq -r .name "$root/.claude-plugin/marketplace.json")"
code="$(sed -n "s/^export const MARKETPLACE = '\(.*\)'$/\1/p" "$hooks/forge.ts")"
if [ "$code" != "$manifest" ]; then
  echo "MARKETPLACE in hooks/forge.ts is '$code', marketplace.json says '$manifest'" >&2
  exit 1
fi
keys="whats-next@$manifest\.\(icons\|compact\)'"
others="$(grep -rnF -- "$manifest" "$hooks" | grep -v "^$hooks/forge.ts:" | grep -v "^$hooks/register.tsx:.*$keys" || true)"
if [ -n "$others" ] || [ "$(grep -cF -- "$manifest" "$hooks/forge.ts")" != 1 ]; then
  echo "the marketplace name is written in more than one place:" >&2
  grep -rnF -- "$manifest" "$hooks" >&2
  exit 1
fi
echo "the marketplace name is '$manifest', in one place"
