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
* [ ] Confirm the application opens (dismiss the updater)
* [ ] Create a project
* [ ] Run two basic Zookeeper prompts
* [ ] Confirm the result is viewable in an engine stream
* [ ] Use 'Check for updates' to bring back the updater toast
* [ ] Confirm the app can update to the previous release

### macOS via ???

* [ ] Download the release build for this platform
* [ ] Confirm the application opens (dismiss the updater)
* [ ] Create a project
* [ ] Run two basic Zookeeper prompts
* [ ] Confirm the result is viewable in an engine stream
* [ ] Use 'Check for updates' to bring back the updater toast
* [ ] Confirm the app can update to the previous release

### Linux via ???

* [ ] Download the release build for this platform
* [ ] Confirm the application opens (dismiss the updater)
* [ ] Create a project
* [ ] Run two basic Zookeeper prompts
* [ ] Confirm the result is viewable in an engine stream
* [ ] Use 'Check for updates' to bring back the updater toast
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

# KCL

<details><summary>Instructions</summary><br>

Follow the instructions [here](https://github.com/KittyCAD/modeling-app/blob/main/rust/README.md) to publish new crates.
This ensures that the KCL accepted by the app is also accepted by the CLI.

Paste a link to the PR below.

</details><br>

Release PR: ???

# Website

<details><summary>Instructions</summary><br>

If there are documentation changes, merge the corresponding Dependabot PRs [here](https://github.com/KittyCAD/website/pulls/app%2Fdependabot) for the website.
You can trigger Dependabot to check for updates [here](https://github.com/KittyCAD/website/network/updates/17261214/jobs).

Paste that link to the PR below or replace `???` with `N/A`.

</details><br>

Release PR: ???

# CLI

<details><summary>Instructions</summary><br>

Clone https://github.com/KittyCAD/cli and update its dependencies on `kittycad-modeling-cmds`, `kcl-lib`, `kcl-derive-docs` and `kcl-test-server` to the latest versions. Also bump the CLI's version under `[package]`. Open a PR and merge it to main.

After merging, run `make tag` and follow its instructions. This should publish a CLI release. Then open <https://github.com/KittyCAD/homebrew-kittycad/pulls> and merge the automatic PR to bump the release in Homebrew.

Paste link to the PR below.

</details><br>

Release PR: ???
