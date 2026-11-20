#!/usr/bin/env bash
set -euo pipefail

directory="$RUNNER_TEMP/engine-cassettes-v2"
recordings="$RUNNER_TEMP/engine-recordings-v2"
shared="engine-cassettes-v2-main"
scope="$shared"
if [[ -n "${PR_NUMBER:-}" ]]; then
  scope="engine-cassettes-v2-pr-$PR_NUMBER"
fi

{
  echo "directory=$directory"
  echo "recordings=$recordings"
  echo "name=$scope-shard-$SHARD_INDEX"
} >> "$GITHUB_OUTPUT"

if [[ "$FORCE_LIVE" == true ]]; then
  echo "live=1" >> "$GITHUB_OUTPUT"
  echo "Engine cassettes: forced live ($scope)"
  exit 0
fi

repo="/repos/$GITHUB_REPOSITORY"
lookup_started=$SECONDS
if ! workflow_id=$(gh api "$repo/actions/workflows/e2e-tests.yml" --jq '.id') ||
  [[ ! "$workflow_id" =~ ^[0-9]+$ ]]; then
  echo "::warning::Could not establish the cassette workflow ID. Tagged tests will run live."
  exit 0
fi

lookup=$(mktemp -d)
trap 'rm -rf "$lookup"' EXIT
pids=()
list_scope() {
  local prefix="$1" shard
  for ((shard=1; shard<=SHARD_TOTAL; shard++)); do
    (
      if gh api --paginate "$repo/actions/artifacts?name=$prefix-shard-$shard&per_page=100" > "$lookup/$prefix-$shard.tmp"; then
        mv "$lookup/$prefix-$shard.tmp" "$lookup/$prefix-$shard.json"
      else
        echo "::warning::Could not list cassettes for $prefix shard $shard."
      fi
    ) &
    pids+=("$!")
  done
}

list_scope "$shared"
if [[ "$scope" != "$shared" ]]; then
  list_scope "$scope"
fi
for pid in "${pids[@]}"; do wait "$pid"; done
echo "Engine cassette listing took $((SECONDS - lookup_started))s"


# Accept only artifacts from the intended workflow, repository and event.
# Copy newest first per file so a partial refresh or a shard move keeps older
# recordings for other tests. PR recordings take precedence over main.
download_scope() {
  local prefix="$1" branch="$2" pr="$3" candidates run_id name staging shard recording filename
  local -a downloaded=()
  local -a listings=()
  for ((shard=1; shard<=SHARD_TOTAL; shard++)); do
    if [[ -f "$lookup/$prefix-$shard.json" ]]; then
      listings+=("$lookup/$prefix-$shard.json")
    fi
  done
  if (( ${#listings[@]} == 0 )); then return 0; fi
  if ! candidates=$(jq -sr --arg branch "$branch" --argjson repo "$GITHUB_REPOSITORY_ID" '
    [.[].artifacts[] | select(.expired == false and
      .workflow_run.head_branch == $branch and
      .workflow_run.repository_id == $repo and .workflow_run.head_repository_id == $repo)]
    | sort_by(.created_at, .id) | reverse[]
    | [.workflow_run.id, .name] | @tsv' "${listings[@]}"); then
    echo "::warning::Could not read the cassette listing for $prefix."
    return 0
  fi
  while IFS=$'\t' read -r run_id name; do
    [[ -n "$run_id" ]] || continue
    shard=${name##*-shard-}
    [[ "$shard" =~ ^[1-9][0-9]*$ ]] || continue
    # Bound downloads even if a run has many prior refreshes. A cache miss
    # after this lookback uses the normal live recording path.
    if (( ${downloaded[$shard]:-0} >= 2 )); then continue; fi
    local run
    if ! run=$(gh api "$repo/actions/runs/$run_id"); then
      echo "::warning::Could not verify cassette provenance for run $run_id."
      continue
    fi
    if ! jq -e --argjson workflow "$workflow_id" --arg pr "$pr" '
      .workflow_id == $workflow and
      (if $pr == "" then (.event == "schedule" or .event == "push")
       else .event == "pull_request" and any(.pull_requests[]?; (.number | tostring) == $pr)
       end)
    ' >/dev/null <<< "$run"; then
      echo "Ignoring cassette artifact from run $run_id outside $prefix"
      continue
    fi
    staging="$lookup/download-$run_id-$name"
    mkdir -p "$staging"
    if ! gh run download "$run_id" --repo "$GITHUB_REPOSITORY" --name "$name" --dir "$staging"; then
      echo "::warning::Cassette $name from run $run_id is unavailable. Trying older recordings."
      continue
    fi
    downloaded[$shard]=$(( ${downloaded[$shard]:-0} + 1 ))
    mkdir -p "$directory"
    for recording in "$staging"/*.json; do
      [[ -f "$recording" ]] || continue
      filename=${recording##*/}
      [[ "$filename" =~ ^[0-9a-f]{64}\.json$ ]] || continue
      if [[ ! -e "$directory/$filename" ]]; then
        cp "$recording" "$directory/$filename"
        echo "Engine cassette $filename from $name (run $run_id)"
      fi
    done
    rm -rf "$staging"
  done <<< "$candidates"
}

if [[ -n "${PR_NUMBER:-}" ]]; then
  download_scope "$scope" "$PR_HEAD_REF" "$PR_NUMBER"
fi
download_scope "$shared" main ''
if [[ ! -d "$directory" ]]; then
  echo "No eligible engine cassettes found. Tagged tests will record live."
fi
echo "Engine cassette preparation took $((SECONDS - lookup_started))s"
