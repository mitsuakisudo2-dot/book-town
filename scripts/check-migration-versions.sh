#!/usr/bin/env bash
# Fails when a migration this commit adds would not run after the base
# branch's: its version (the 14 digits before the first "_") must be its own
# and later than the newest version on the base branch. Production applies
# migrations in version order once they reach main (deploy-database.yml), and
# `supabase db push` refuses one older than the newest it has applied, so the
# number is given just before merging and checked here.
#
# It also fails when a migration on the base branch is changed, removed or
# renamed. Once on main a migration is applied to production by its version
# alone, so a changed file never reaches production while the tests build
# their database from it, and a removed one stops the next deploy
# (docs/開発と運用/DBの変え方.md: a fix is a new migration).
#
# Usage: scripts/check-migration-versions.sh <base commit>
set -euo pipefail

base=${1:?"usage: $0 <base commit>"}
dir=supabase/migrations
if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "::error::$base is not a commit here; fetch the base branch first."
  exit 1
fi

# The names of a commit's migrations, one a line.
migrations() {
  git ls-tree --name-only "$1" -- "$dir/" | sed 's#.*/##' | grep '\.sql$' || true
}
version() {
  sed -n 's/^\([0-9]\{14\}\)_.*/\1/p' <<<"$1"
}

mapfile -t before < <(migrations "$base")
mapfile -t after < <(migrations HEAD)
newest=""
for name in "${before[@]}"; do
  [[ "$(version "$name")" > "$newest" ]] && newest=$(version "$name")
done

failed=0
for name in "${before[@]}"; do
  was=$(git rev-parse "$base:$dir/$name")
  if ! now=$(git rev-parse --verify --quiet "HEAD:$dir/$name"); then
    echo "::error file=$dir/$name::$name is on the base branch and was removed or renamed; add a new migration instead."
    failed=1
  elif [[ "$now" != "$was" ]]; then
    echo "::error file=$dir/$name::$name is on the base branch and was changed; production will not run it again, so add a new migration instead."
    failed=1
  fi
done
for name in "${after[@]}"; do
  printf '%s\n' "${before[@]}" | grep -qxF -- "$name" && continue
  added=$(version "$name")
  problem=""
  if [[ -z "$added" ]]; then
    problem="does not start with a 14-digit version and an underscore"
  elif (($(printf '%s\n' "${after[@]}" | grep -c "^${added}_") > 1)); then
    problem="shares its version $added with another migration"
  elif [[ -n "$newest" ]] && ! [[ "$added" > "$newest" ]]; then
    problem="needs a version after $newest, the newest on the base branch"
  fi
  if [[ -n "$problem" ]]; then
    echo "::error file=$dir/$name::$name $problem."
    failed=1
  else
    echo "$name comes after ${newest:-every migration} on the base branch."
  fi
done
exit "$failed"
