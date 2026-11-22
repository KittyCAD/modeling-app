# Dev account app configuration experiment

Branch `codex/personal-app-config` combines the local authored-plugin prototype,
app-manifest stack, and optional `zoo:appLogo` header contribution. This experiment
reads a configuration Project pointer after authentication and applies its bundled
renderer-extension selection. It does not yet load authored extensions from that
Project, grant permissions, or change native Electron plugin registration.

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
   `app.toml` is downloaded. Copy the Project ID, not its library or version ID.

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

4. In DevTools, look for `[dev-app-config] Applied app configuration from Project
   ... at version ...`. On Home and in the new project shell the default Zoo
   logo/Home link should disappear; the project and account controls should remain.
   Opening plugin source should still offer Plugin Builder and TypeScript syntax
   support. This configuration does not uninstall existing personal plugins.

5. Check the Network panel: the app reads Project metadata, resolves one exact
   version, and requests a ZIP containing only the `app.toml` file ID. If supplied
   by the API, the file SHA-256 is verified before parsing. The current Project
   version is resolved anew on each fresh auth initialization; there is no persistent
   configuration-release lock yet.

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
or import arbitrary JavaScript. Project source resolution for authored extensions
and the safe header contribution adapter are subsequent work.

## Verification in this branch

The targeted configuration/plugin/editor tests and formatting/type/lint checks
pass. An isolated real-app browser check with mocked auth and Projects endpoints
verified reading the Company pointer at auth initialization, applying the fetched
manifest, and restoring the logo on logout without page errors.

The broader `src/lib/app.spec.ts` integration suite still encounters the singleton
`boot.ts` import cycle also reproduced on the original community-plugin branch.
The isolated browser check runs normal app boot rather than importing App directly
through that test cycle. A live dev-account smoke test remains necessary to
confirm the account field and Project permissions for the actual account.
