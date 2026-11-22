# Dev account app configuration experiment

Branch `codex/personal-app-config` combines the local authored-plugin prototype,
app-manifest stack, and optional `zoo:appLogo` header contribution. This experiment
reads a configuration Project pointer after authentication and applies its bundled
renderer-extension selection. Its `sources` table can also load permissionless
authored extensions from pinned Project versions. It never grants permissions or
changes native Electron plugin registration.

## Smoke test

1. Sign in normally against the dev API. Create a cloud Project the user can read.
   Add `app.toml` at the Project root and wait for its cloud save to finish:

   ```toml
   schema-version = 1
   base = "zoo:default"

   [extensions]
   exclude = ["zoo:appLogo"]
   ```

   The Project can retain its ordinary `project.toml` and design files. Only
   `app.toml` and explicitly selected source entrypoints are downloaded. Copy the
   Project ID, not its library or version ID.

2. Record the dev user's original Company value. On that **user record**, set:

   ```text
   zds-dev-app-config:<project-uuid>
   ```

   `company` is writable through `PUT /user` and returned by `GET /user`;
   it is separate from organization membership. A minimal SDK update body is
   `{ "company": "zds-dev-app-config:<project-uuid>", "image": "" }`.
   The empty image leaves the existing avatar unchanged. With the dev token in
   `ZOO_API_TOKEN` and the Project UUID in `CONFIG_PROJECT_ID`, the API round-trip is:

   ```sh
   curl --fail-with-body --request PUT https://api.dev.zoo.dev/user \
     --header "Authorization: Bearer $ZOO_API_TOKEN" \
     --header 'Content-Type: application/json' \
     --data "$(jq -n --arg company "zds-dev-app-config:$CONFIG_PROJECT_ID" '{company: $company, image: ""}')"

   curl --fail-with-body https://api.dev.zoo.dev/user \
     --header "Authorization: Bearer $ZOO_API_TOKEN" | jq '{id, company}'
   ```

   Verify that `GET /user` returns the exact prefixed value. This is the
   server-side check for the particular dev account, including an org member.
   The branch does not update any account fields itself.

3. In this branch's worktree, use the usual project dependencies, generated
   Wasm/bindings, and local dev environment. Launch normally:

   ```sh
   npm run start
   ```

   Open the local app and sign in as usual. The auth hook runs automatically in
   dev builds on this branch; no additional flag, API-token override, or special
   port is required. The optional token-based commands in step 2 are only one way
   to update and inspect the account field. This worktree has its own environment
   files; existing local files in a different checkout are not automatically
   copied here.

   Desktop uses the same hook with `make run-desktop` (live Electron renderer).
   A dev build made with `npm run tronb:vite:dev` also includes it: the hook checks
   Vite's `development` mode, not `import.meta.env.DEV`, which is false for builds.

4. In DevTools, look for `[dev-app-config] Applied app configuration from Project
   ... at version ...`. On Home and in the new project shell the default Zoo
   logo/Home link should disappear; the project and account controls should remain.
   Opening plugin source should still offer Plugin Builder and TypeScript syntax
   support. This configuration does not uninstall existing personal plugins.

5. Check the Network panel: the app reads Project metadata, resolves one exact
   version, and requests `app.toml` by file ID. Selected authored entrypoints are
   downloaded by file ID from that same version, or from an explicitly pinned
   external Project version. API-provided and manifest-provided SHA-256 digests
   are verified. The account configuration's current version is resolved anew on
   fresh auth initialization; there is no persistent configuration-release lock.

## Load the logo directly from the configuration Project

1. Upload `examples/community-plugins/personal-logo.zds.ts` to the root of the same
   cloud Project containing your account configuration. Customize its SVG and text.
2. Replace `app.toml` with `examples/app-configs/cloud-logo.toml`:

   ```toml
   schema-version = 1
   base = "zoo:default"

   [extensions]
   exclude = ["zoo:appLogo"]
   add = ["personal:logo"]

   [sources."personal:logo"]
   kind = "project"
   entrypoint = "personal-logo.zds.ts"
   ```

3. Wait for both files to save to the cloud, then reload ZDS. The logo is loaded
   with the configuration; Plugin Builder installation is unnecessary. Disable or
   uninstall the earlier manual test copy to avoid rendering both copies.
4. Remove `personal:logo` from `extensions.add` and reload to remove the authored
   logo. Logging out also removes configured extensions and restores startup branding.

Omitting `project_id` and `version_id` uses the configuration Project's exact
resolved version, so the source matches the manifest even if the Project changes
while loading. Another Project requires both fields:

```toml
[sources."company:logo"]
kind = "project"
project_id = "<project-uuid>"
version_id = "<immutable-version-id>"
entrypoint = "extensions/logo.zds.ts"
# Optional additional content pin:
# sha256 = "<64 hexadecimal characters>"
```

Source IDs are host aliases, not publisher verification or permission grants.
Only selected sources are fetched or evaluated. Source code is compiled and run in
QuickJS through the same checked contribution adapters as local plugins. This first
slice accepts `permissions = []`; requested permissions fail with an actionable
error instead of inheriting a manually installed plugin's grants. Configuration
extensions follow the composition lifetime and have no independent activation
toggle or persisted Plugin Builder installation. Configuration-owned settings pages
are not supported yet and are rejected explicitly.

A malformed source, digest mismatch, unsupported contribution, or compilation/
activation failure prevents applying the new composition. Source runtimes are
released on failed preparation, replacement, logout, and canceled auth generations.

## Failure and rollback checks

- Change the manifest to `schema-version = 999`, save it, then reload. Expect an
  actionable configuration error and the startup logo to remain available.
- Excluding `zoo:auth` must be rejected. Changing slicer/native registration must
  also be rejected; those changes still require the startup manifest.
- Log out: the startup composition is restored. A late response from the old
  account cannot apply after logout or an account/environment change.
- Restore the original Company value and reload: ordinary company names are ignored.
- Switching back to the original branch removes the experiment. Production
  builds ignore the hook.

The pointer is a temporary use of the Company field, not a new account API contract.
The manifest cannot remove mandatory host services, approve plugin permissions,
or import arbitrary JavaScript into the host realm. Authored code stays in QuickJS
and contributes only through registered host adapters.

## Verification in this branch

The targeted configuration/plugin/editor tests and formatting/type/lint checks
pass. An isolated real-app browser check with mocked auth and Projects endpoints
verified reading the Company pointer at auth initialization, applying the fetched
manifest and authored logo from one exact Project version without a manual plugin
installation, restoring the authored logo on reload, and restoring startup
branding on logout without page errors.

The broader `src/lib/app.spec.ts` integration suite still encounters the singleton
`boot.ts` import cycle also reproduced on the original community-plugin branch.
The isolated browser check runs normal app boot rather than importing App directly
through that test cycle. A live dev-account smoke test remains necessary to
confirm the account field and Project permissions for the actual account.
