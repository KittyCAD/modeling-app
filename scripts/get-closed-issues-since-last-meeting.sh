#!/bin/bash

# Usage: ./scripts/get-closed-issues-since-last-meeting.sh [LAST_MEETING_DATE_ISO_8601]

last_meeting_date=${1:-'2025-02-10'}
milestone="milestone:\"v1 Modeling App Launch\""
extermination_project="project:KittyCAD/34"
features_project="project:KittyCAD/35"
repo="kittycad/modeling-app"
limit=999

function list_from_ids() {
    for id in $1; do
        title=$(gh issue view $id --repo $repo --json title | jq -r '.title')
        echo "* [$title](https://github.com/$repo/issues/$id)"
    done
}

echo "Closed issues on $repo since $last_meeting_date"
echo

closed_bug_ids=$(gh issue list --repo $repo --limit $limit --search "sort:closed-asc closed:>$last_meeting_date $extermination_project" --json number | jq -r '.[].number')
echo "### Tracked bugs completed"
echo "Bugs closed that were on our Extermination Station project:"
list_from_ids "$closed_bug_ids"
echo

closed_enchancement_ids=$(gh issue list --repo $repo --limit $limit --search "sort:closed-asc closed:>$last_meeting_date $features_project" --json number | jq -r '.[].number') 
echo "### Tracked enhancements completed"
echo "Feature issues closed that were on our V1 Battle Plan project:"
list_from_ids "$closed_enchancement_ids"
echo

closed_other_ids=$(gh issue list --repo $repo --limit $limit --search "sort:closed-asc closed:>$last_meeting_date no:project" --json number | jq -r '.[].number') 
echo "### Other and untracked"
echo "Other notable work that wasn't tracked in either of those places:"
list_from_ids "$closed_other_ids"
echo
