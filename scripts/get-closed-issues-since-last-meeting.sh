#!/bin/bash

# Usage: echo "$(scripts/get-changelog-from-releases.sh)" > CHANGELOG.md

last_meeting_date=${1:-'2024-02-10'}
filter="milestone:\"v1 Modeling App Launch\""
repo="kittycad/modeling-app"
limit=999

function list_from_ids() {
    for id in $1; do
        title=$(gh issue view $id --repo $repo --json title | jq -r '.title')
        echo "* [https://github.com/$repo/issues/$id]($title)"
    done
}

echo "Closed issues on $repo since $last_meeting_date"
echo

closed_bug_ids=$(gh issue list --repo $repo --limit $limit --search "type:bug sort:closed-asc closed:>$last_meeting_date $filter" --json number | jq -r '.[].number')
echo "### Bugs"
list_from_ids "$closed_bug_ids"
echo

closed_enchancement_ids=$(gh issue list --repo $repo --limit $limit --search "type:enhancement sort:closed-asc closed:>$last_meeting_date $filter" --json number | jq -r '.[].number') 
echo "### Enhancements"
list_from_ids "$closed_enchancement_ids"
echo
