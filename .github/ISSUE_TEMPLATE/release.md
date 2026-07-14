---
name: Release
about: Create a new release for the Zoo Design Studio
title: "Cut release v1.?.?"
labels: [meta/release]
---

# ZDS

## 1. Push a new tag

<details><summary>Instructions</summary><br>

Tag the repo on the latest main:

```
git tag $VERSION --message=""
git push origin $VERSION
```

This will trigger the `build-apps` workflow to set the version, build & sign the apps, and generate release files.

The workflow should be listed right away [in this list](https://github.com/KittyCAD/modeling-app/actions/workflows/build-apps.yml?query=event%3Apush).
Paste that link to that GitHub Actions run below.

</details><br>

Workflow run: ???

## 2. Manually test artifacts

<details><summary>Instructions</summary><br>

The release builds can be found under the `out-{arch}-{platform}` zip files, at the very bottom of the `build-apps` summary page for the workflow (triggered by the tag in step 1).

Assign someone to each section of the manual checklist.

</details>

### Windows via ???

* [ ] Download the release build for this platform
* [ ] Install and run it (ignore the status bar update)
* [ ] Create a new project
* [ ] Send and queue two basic Zookeeper prompts
* [ ] Confirm the result is viewable in an engine stream
* [ ] Click **Restart to update** in the status bar
* [ ] Confirm the app can update to the previous release

### macOS via ???

* [ ] Download the release build for this platform
* [ ] Install and run it (ignore the status bar update)
* [ ] Create a new project
* [ ] Send and queue two basic Zookeeper prompts
* [ ] Confirm the result is viewable in an engine stream
* [ ] Click **Restart to update** in the status bar
* [ ] Confirm the app can update to the previous release

### Linux via ???

* [ ] Download the release build for this platform
* [ ] Install and run it (ignore the status bar update)
* [ ] Create a new project
* [ ] Send and queue two basic Zookeeper prompts
* [ ] Confirm the result is viewable in an engine stream
* [ ] Click **Restart to update** in the status bar
* [ ] Confirm the app can update to the previous release

## 3. Draft release notes

<details><summary>Instructions</summary><br>

Head over to https://github.com/KittyCAD/modeling-app/releases/new, pick the newly created tag and type it in the **Release title** field as well.

Click **Generate release notes** as a starting point to for the changelog. Paste and reword user-facing changes below, collaborating with the original PR authors.

</details><br>

```
## Added

* ???

## Changed

* ???

## Fixed

* ???

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/???
```

## 4. Publish the release

<details><summary>Instructions</summary><br>

Paste the finalized release notes back to GitHub. Make sure **Set as the latest release** is checked, and click **Publish release**.

A new `publish-apps-release` workflow will start and you should be able to find it [here](https://github.com/KittyCAD/modeling-app/actions?query=event%3Arelease). Paste that link below.

On success, the files will be uploaded to the public bucket as well as to the GitHub release, and the announcement on Discord will be sent.

</details><br>

Workflow run: ???

<details><summary>Rollback instructions</summary><br>

If anything goes wrong during the deployment of the new release and it needs to be yanked (or rolled back),
the quickest way is to locate the previous release publish job and simply re-run it.

Use the Announcements API to communicate the urgency of the rollback to users.

1. Head to https://github.com/KittyCAD/modeling-app/actions/workflows/publish-apps.yml
2. Click the previous `publish-apps` job, eg. https://github.com/KittyCAD/modeling-app/actions/runs/22152987561
3. Click _Re-run all jobs_ and wait for success
4. Confirm https://zoo.dev/design-studio/download shows the previous release
5. Post a message in Discord #release announcing the release got yanked
6. Mark the yanked release as _Pre-release_, eg. https://github.com/KittyCAD/modeling-app/releases/tag/v1.1.13

</details><br>

# KCL

<details><summary>Instructions</summary><br>

Follow the instructions [here](https://github.com/KittyCAD/modeling-app/blob/main/rust/README.md) to publish new crates.
This ensures that the KCL accepted by the app is also accepted by the CLI.

Paste a link to the PR below.

</details><br>

Release PR: ???

# CLI

<details><summary>Instructions</summary><br>

Clone https://github.com/KittyCAD/cli and update its dependencies on `kittycad-modeling-cmds`, `kcl-lib`, `kcl-derive-docs` and `kcl-test-server` to the latest versions. Also bump the CLI's version under `[package]`. Open a PR and merge it to main.

After merging, run `make tag` and follow its instructions. This should publish a CLI release. Then open <https://github.com/KittyCAD/homebrew-kittycad/pulls> and merge the automatic PR to bump the release in Homebrew.

Paste a link to the PR below.

The above should generate a PR in https://github.com/KittyCAD/homebrew-kittycad/pulls. Merge it.

</details><br>

Release PR: ???

Homebrew KittyCAD PR: ???

# API

<details><summary>Instructions</summary><br>

Clone https://github.com/KittyCAD/api and update its dependencies on `kittycad-modeling-cmds` and `kcl-lib` to the latest versions. Next, run `just redo-openapi` to make sure the OpenAPI spec gets generated from any types we might be exposing from these libs. Open a PR and merge it to main.

Paste a link to the PR below.

</details><br>

Release PR: ???

# Zookeeper

<details><summary>Instructions</summary><br>

Merge the corresponding `zoo-kcl` Dependabot PR [here](https://github.com/KittyCAD/text-to-cad/pulls?q=is%3Apr+zoo-kcl). If none are present, click **Check for updates** [here](https://github.com/KittyCAD/text-to-cad/network/updates/27829916/jobs).

Paste a link to the PR below.

</details><br>

Release PR: ???

# Website

<details><summary>Instructions</summary><br>

Merge the latest `documentation` Dependabot PR [here](https://github.com/KittyCAD/website/pulls?q=is%3Apr+documentation). If none are present, click **Check for updates** [here](https://github.com/KittyCAD/website/network/updates/17261214/jobs).

Paste a link to the PR below or replace `???` with `N/A`.

</details><br>

Release PR: ???
