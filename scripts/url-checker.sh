#!/bin/bash
set -euo pipefail
trap 'echo "$BASH_COMMAND"' ERR

remove_after_space () {
    sed 's/ .*//'
}

remove_after_backtick () {
    sed 's/`.*//'
}

remove_after_end_paren () {
    sed 's/).*//'
}

remove_after_double_quote () {
    sed 's/".*//'
}

remove_after_gt () {
    sed 's/>.*//'
}

remove_after_comma () {
    sed 's/,.*//'
}

# Search all src/**/*.ts files
val1=$(grep -Eoh "(https)://[^']+" src/**/*.ts  | remove_after_space | remove_after_backtick | remove_after_end_paren | remove_after_double_quote | remove_after_gt | remove_after_comma)

# Search all src/**/*.tsx files
val2=$(grep -Eoh "(https)://[^']+" src/**/*.tsx  | remove_after_space | remove_after_backtick | remove_after_end_paren | remove_after_double_quote | remove_after_gt | remove_after_comma)

# Required a newline between them when combining since there is not one at the end of val1
combined="$val1"$'\n'"$val2"

# Merge both ts and tsx results and unique them
# cat url_result1.txt url_result2.txt > url_result3.txt
# cat url_result3.txt | sort | uniq > url_result4.txt
uniqued=$(echo "$combined" | sort | uniq)

# All urls and status codes
all="URL\tSTATUS\n"

# All non 200 urls and status codes
problematic="URL\tSTATUS\n"
while read line; do
    # || true this curl request to bypass any failures and not have the scrip panic.
    # the set -euo pipefail will cause a panic if a curl fails
    status=$(curl -o /dev/null -s -w "%{http_code}\n" $line || true)
    all+="$status\t$line\n"
    if [[ "$status" -ne 200 ]]; then
        # list status first over line because of white space formatting, less annoying for diffing
        problematic+="$status\t$line\n"
    fi
done < <(echo "$uniqued")
echo -e $problematic | column -t
