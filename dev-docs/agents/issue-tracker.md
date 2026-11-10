# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `KittyCAD/modeling-app`:
https://github.com/KittyCAD/modeling-app/issues

## Access

Use `gh` only when already authenticated. Do not initiate authentication or request credentials.

When CLI access is unavailable:

- Ask the user for only the issue details needed: URL or number, title, body, state, labels, and relevant comments.
- Prepare complete issue text or exact changes for the user to apply through the browser.
- Treat a write as complete only after the user confirms the result and supplies the issue URL.

## CLI conventions

Add `--repo KittyCAD/modeling-app` to every issue command below.

- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --json number,title,body,state,labels,comments`
- List: `gh issue list --state open --json number,title,body,labels,assignees`
- Edit body: `gh issue edit <number> --body-file <file>`
- Comment: `gh issue comment <number> --body-file <file>`
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: post the explanation with `gh issue comment`, then run `gh issue close <number>`. Post the explanation separately even when the issue is already closed.

Use files for multiline bodies. Confirm the target repository before publishing.

## Relationships and blockers

Use native GitHub sub-issues and issue dependencies where available:

- Parent: `gh issue create --parent <parent> ...`
- Existing child: `gh issue edit <parent> --add-sub-issue <child>`
- Blocking: `gh issue edit <child> --add-blocked-by <blocker>`

When native relationships are unavailable, put `Part of #<parent>` and `Blocked by: #<number>` lines at the top of the child body. A ticket is unblocked when every blocker is closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill terminology

"Publish to the issue tracker" means create a GitHub issue.
"Fetch the relevant ticket" means read the GitHub issue and relevant comments.

When publication requires the user's browser, prepare the complete content and wait for confirmation that it was published.
