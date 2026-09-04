# Rolling out project pagination

Ship this modeling-app change before switching `GET /user/projects` from a bare
array to `{ items, next_page }`. The app accepts both formats, keeps the existing
request URL for the first page, and follows each opaque cursor to completion.
If a legacy array arrives during a paginated refresh (API rollback or a mixed
server rollout), it replaces the in-progress collection as a complete inventory.

Each request uses the existing credentials and request throttle. Duplicate project
IDs are merged. Failed pages, malformed responses, and repeated cursors reject the
refresh without publishing a partial inventory. The existing retry handling gets
the original HTTP error, including `Retry-After`.

Because cursor pages are not a snapshot, an omitted project is checked through
`GET /user/projects/{id}` before local reconciliation. Only a 404 permits removing
a clean mirror or disconnecting a modified local project. Other errors preserve
local files and their cloud link. A refresh completed after a configuration change
is discarded.

## Release sequence

1. Release this app version while the API still returns arrays.
2. Update the website loaders for the new response format too.
3. Smoke test against both API formats, then deploy API pagination.
4. Keep the new app code during API rollback; it supports either response shape.

Older installed app versions remain incompatible with the new API. If those
versions must keep working, keep a versioned legacy endpoint or require an app
upgrade before changing the existing endpoint. Releasing this branch alone does
not make old installations safe.

## Smoke tests

Use a test account and disposable projects on web and desktop:

- Verify existing project loading and syncing against the array API.
- With more than 100 projects, verify the final page's projects remain linked and
  can be opened and synced against the paginated API.
- Fail a later page and confirm the prior inventory, local files, and cloud links
  remain intact; restore connectivity and verify retry succeeds.
- Omit a project from the list while its detail endpoint still returns 200; verify
  it is retained. Confirm actual deletion still reconciles after a 404.
- Disable sync or change accounts while a page is pending; verify the old refresh
  does not replace the new account's inventory.
- Roll the API back to arrays and verify the upgraded app continues to sync.

Automated regression tests cover the loader and sync engine with mocked HTTP,
the test filesystem, and IndexedDB. Live deployment and packaged-app behavior still
need the smoke tests above. Fetching the whole inventory remains proportional to
the total number of projects; an incremental changes feed is a separate future
improvement.
