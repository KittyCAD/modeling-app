# Contributor Guide

## Running a development build

Install a node version manager such as [fnm](https://github.com/Schniz/fnm?tab=readme-ov-#installation).

On Windows, it's also recommended to [upgrade your PowerShell version](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows?view=powershell-7.5#winget), we're using 7.

Then in the repo run the following to install and use the node version specified in `.nvmrc`. You might need to specify your processor architecture with `--arch arm64` or `--arch x64` if it's not autodetected.

```
fnm install --corepack-enabled
fnm use
```

Install the NPM dependencies with:

```
npm install
```

This project uses a lot of Rust compiled to [WASM](https://webassembly.org/) within it. We have package scripts to run rustup, see `package.json` for reference:

```
# macOS/Linux
npm run install:rust
npm run install:wasm-pack:sh

# Windows
npm run install:rust:windows
npm run install:wasm-pack:cargo
```

Then to build the WASM layer, run:

```
# macOS/Linux
npm run build:wasm

# Windows
npm run build:wasm:windows
```

Or if you have the `gh` cli installed and want to download the latest main wasm bundle. Note that on Windows, you need to associate .ps1 files with PowerShell, which can be done via the right click menu, selecting `C:\Program Files\PowerShell\7\pwsh.exe`, and you can install tools like `gh` via `npm run install:tools:windows`.

```
# macOS/Linux
npm run fetch:wasm

# Windows
npm run fetch:wasm:windows
```

That will build the WASM binary and put in the `public` dir (though gitignored).

Finally, to run the web app only, run:

```
npm start
```

If you're not a Zoo employee you won't be able to access the dev environment, you should copy everything from `.env.production` to `.env.development.local` to make it point to production instead, then when you navigate to `localhost:3000` the easiest way to sign in is to paste `localStorage.setItem('TOKEN_PERSIST_KEY', "your-token-from-https://zoo.dev/account/api-tokens")` replacing the with a real token from https://zoo.dev/account/api-tokens of course, then navigate to `localhost:3000` again. Note that navigating to `localhost:3000/signin` removes your token so you will need to set the token again.

### Development environment variables

The Copilot LSP plugin in the editor requires a Zoo API token to run. In production, we authenticate this with a token via cookie in the browser and device auth token in the desktop environment, but this token is inaccessible in the dev browser version because the cookie is considered "cross-site" (from `localhost` to `zoo.dev`). There is an optional environment variable called `VITE_KC_DEV_TOKEN` that you can populate with a dev token in a `.env.development.local` file to not check it into Git, which will use that token instead of other methods for the LSP service.

### Developing in Chrome

Chrome is in the process of rolling out a new default which
[blocks Third-Party Cookies](https://developer.chrome.com/en/docs/privacy-sandbox/third-party-cookie-phase-out/).
If you're having trouble logging into the `modeling-app`, you may need to
enable third-party cookies. You can enable third-party cookies by clicking on
the eye with a slash through it in the URL bar, and clicking on "Enable
Third-Party Cookies".

## Desktop

To spin up the desktop app, `npm install` and `npm run build:wasm` need to have been done before hand then:

```
npm run tron:start
```

This will start the application and hot-reload on changes.

Devtools can be opened with the usual Command-Option-I (macOS) or Ctrl-Shift-I (Linux and Windows).

To package the app for your platform with electron-builder, run `npm run tronb:package:dev` (or `npm run tronb:package:prod` to point to the .env.production variables).

## Checking out commits / Bisecting

Which commands from setup are one off vs. need to be run every time?

The following will need to be run when checking out a new commit and guarantees the build is not stale:

```bash
npm install
npm run build:wasm
npm start
```

## Before submitting a PR

Before you submit a contribution PR to this repo, please ensure that:

- There is a corresponding issue for the changes you want to make, so that discussion of approach can be had before work begins.
- You have separated out refactoring commits from feature commits as much as possible
- You have run all of the following commands locally:
  - `npm run fmt`
  - `npm run tsc`
  - `npm run test`
  - Here they are all together: `npm run fmt && npm run tsc && npm run test`

## Release a new version

#### 1. Create a 'Cut release $VERSION' issue

It will be used to document changelog discussions and release testing.

https://github.com/KittyCAD/modeling-app/issues/new

#### 2. Push a new tag

Create a new tag and push it to the repo. The `semantic-release.sh` script will automatically bump the minor part, which we use the most. For instance going from `v0.27.0` to `v0.28.0`.

```
VERSION=$(./scripts/semantic-release.sh)
git tag $VERSION
git push origin --tags
```

This will trigger the `build-apps` workflow, set the version, build & sign the apps, and generate release files as well as updater-test artifacts.

The workflow should be listed right away [in this list](https://github.com/KittyCAD/modeling-app/actions/workflows/build-apps.yml?query=event%3Apush)).

#### 3. Manually test artifacts

##### Release builds

The release builds can be found under the `out-{arch}-{platform}` zip files, at the very bottom of the `build-apps` summary page for the workflow (triggered by the tag in 2.).

Manually test against this [list](https://github.com/KittyCAD/modeling-app/issues/3588) across Windows, MacOS, Linux and posting results as comments in the issue.

##### Updater-test builds

The other `build-apps` output in the release `build-apps` workflow (triggered by 2.) is `updater-test-{arch}-{platform}`. It's a semi-automated process: for macOS, Windows, and Linux, download the corresponding updater-test artifact file, install the app, run it, expect an updater prompt to a dummy v0.255.255, install it and check that the app comes back at that version.

The only difference with these builds is that they point to a different update location on the release bucket, with this dummy v0.255.255 always available. This helps ensuring that the version we release will be able to update to the next one available.

If the prompt doesn't show up, start the app in command line to grab the electron-updater logs. This is likely an issue with the current build that needs addressing (or the updater-test location in the storage bucket).

```
# Windows (PowerShell)
& 'C:\Program Files\Zoo Design Studio\Zoo Design Studio.exe'

# macOS
/Applications/Zoo\ Modeling\ App.app/Contents/MacOS/Zoo\ Modeling\ App

# Linux
./Zoo Design Studio-{version}-{arch}-linux.AppImage
```

#### 4. Publish the release

Head over to https://github.com/KittyCAD/modeling-app/releases/new, pick the newly created tag and type it in the _Release title_ field as well.

Hit _Generate release notes_ as a starting point to discuss the changelog in the issue. Once done, make sure _Set as the latest release_ is checked, and hit _Publish release_.

A new `publish-apps-release` will kick in and you should be able to find it [here](https://github.com/KittyCAD/modeling-app/actions?query=event%3Arelease). On success, the files will be uploaded to the public bucket as well as to the GitHub release, and the announcement on Discord will be sent.

#### 5. Close the issue

If everything is well and the release is out to the public, the issue tracking the release shall be closed.

## Fuzzing the parser

Make sure you install cargo fuzz:

```bash
$ cargo install cargo-fuzz
```

```bash
$ cd rust/kcl-lib

# list the fuzz targets
$ cargo fuzz list

# run the parser fuzzer
$ cargo +nightly fuzz run parser
```

For more information on fuzzing you can check out
[this guide](https://rust-fuzz.github.io/book/cargo-fuzz.html).

## Tests

### Playwright tests

Prepare these system dependencies:

- Set $token from https://zoo.dev/account/api-tokens

#### Snapshot tests (Google Chrome on Ubuntu only)

Only Ubunu and Google Chrome is supported for the set of tests evaluating screenshot snapshots.
If you don't run Ubuntu locally or in a VM, you may use a GitHub Codespace.
```
npm run playwright -- install chrome
npm run test:snapshots
```
You may use `-- --update-snapshots` as needed.

#### Electron flow tests (Chromium on Ubuntu, macOS, Windows)

```
npm run playwright -- install chromium
npm run test:playwright:electron:local
```
You may use `-- -g "my test"` to match specific test titles, or `-- path/to/file.spec.ts` for a test file.

#### Debugger

However, if you want a debugger I recommend using VSCode and the `playwright` extension, as the above command is a cruder debugger that steps into every function call which is annoying.
With the extension you can set a breakpoint after `waitForDefaultPlanesVisibilityChange` in order to skip app loading, then the vscode debugger's "step over" is much better for being able to stay at the right level of abstraction as you debug the code.

If you want to limit to a single browser use `--project="webkit"` or `firefox`, `Google Chrome`
Or comment out browsers in `playwright.config.ts`.

note chromium has encoder compat issues which is why were testing against the branded 'Google Chrome'

You may consider using the VSCode extension, it's useful for running individual threads, but some some reason the "record a test" is locked to chromium with we can't use. A work around is to us the CI `npm run playwright codegen -b wk --load-storage ./store localhost:3000`

<details>
<summary>

Where `./store` should look like this

</summary>

```JSON
{
  "cookies": [],
  "origins": [
    {
      "origin": "http://localhost:3000",
      "localStorage": [
        {
          "name": "store",
          "value": "{\"state\":{\"openPanes\":[\"code\"]},\"version\":0}"
        },
        {
          "name": "persistCode",
          "value": ""
        },
        {
          "name": "TOKEN_PERSIST_KEY",
          "value": "your-token"
        }
      ]
    }
  ]
}
```

</details>

However because much of our tests involve clicking in the stream at specific locations, it's code-gen looks `await page.locator('video').click();` when really we need to use a pixel coord, so I think it's of limited use.

### Unit and component tests

If you already haven't, run the following:

```
npm
npm run build:wasm
npm start
```

and finally:

```
npm run test:unit
```

For individual testing:

```
npm run test abstractSyntaxTree -t "unexpected closed curly brace" --silent=false
```

Which will run our suite of [Vitest unit](https://vitest.dev/) and [React Testing Library E2E](https://testing-library.com/docs/react-testing-library/intro) tests, in interactive mode by default.

### Rust tests

Prepare these system dependencies:

- Set `$KITTYCAD_API_TOKEN` from https://zoo.dev/account/api-tokens
- Install `just` following [these instructions](https://just.systems/man/en/packages.html)

then run tests that target the KCL language:

```
npm run test:rust
```

### Logging

To display logging (to the terminal or console) set `ZOO_LOG=1`. This will log some warnings and simple performance metrics. To view these in test runs, use `-- --nocapture`.

To enable memory metrics, build with `--features dhat-heap`.
