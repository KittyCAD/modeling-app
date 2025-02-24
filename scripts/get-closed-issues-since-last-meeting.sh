#!/bin/bash

# Usage: ./scripts/get-closed-issues-since-last-meeting.sh [LAST_MEETING_DATE_ISO_8601]

last_meeting_date=${1:-'2025-02-10'}
filter="milestone:\"v1 Modeling App Launch\""
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

closed_bug_ids=$(gh issue list --repo $repo --limit $limit --search "type:Bug sort:closed-asc closed:>$last_meeting_date $filter" --json number | jq -r '.[].number')
echo "### Bugs"
list_from_ids "$closed_bug_ids"
echo

closed_enchancement_ids=$(gh issue list --repo $repo --limit $limit --search "type:Enhancement sort:closed-asc closed:>$last_meeting_date $filter" --json number | jq -r '.[].number') 
echo "### Enhancements"
list_from_ids "$closed_enchancement_ids"
echo

closed_other_ids=$(gh issue list --repo $repo --limit $limit --search "no:type sort:closed-asc closed:>$last_meeting_date $filter" --json number | jq -r '.[].number') 
echo "### Other"
list_from_ids "$closed_other_ids"
echo
