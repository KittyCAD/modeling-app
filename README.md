![Zoo Design Studio](/public/zma-logomark-outlined.png)

## Zoo Design Studio

download at [zoo.dev/modeling-app/download](https://zoo.dev/modeling-app/download)

A CAD application from the future, brought to you by the [Zoo team](https://zoo.dev).

Design Studio is our take on what a modern modelling experience can be. It is applying several lessons learned in the decades since most major CAD tools came into existence:

- All artifacts—including parts and assemblies—should be represented as human-readable code. At the end of the day, your CAD project should be "plain text"
  - This makes version control—which is a solved problem in software engineering—trivial for CAD
- All GUI (or point-and-click) interactions should be actions performed on this code representation under the hood
  - This unlocks a hybrid approach to modeling. Whether you point-and-click as you always have or you write your own KCL code, you are performing the same action in Design Studio
- Everything graphics _has_ to be built for the GPU
  - Most CAD applications have had to retrofit support for GPUs, but our geometry engine is made for GPUs (primarily Nvidia's Vulkan), getting the order of magnitude rendering performance boost with it
- Make the resource-intensive pieces of an application auto-scaling
  - One of the bottlenecks of today's hardware design tools is that they all rely on the local machine's resources to do the hardest parts, which include geometry rendering and analysis. Our geometry engine parallelizes rendering and just sends video frames back to the app (seriously, inspect source, it's just a `<video>` element), and our API will offload analysis as we build it in

We are excited about what a small team of people could build in a short time with our API. We welcome you to try our API, build your own applications, or contribute to ours!

Design Studio is a _hybrid_ user interface for CAD modeling. You can point-and-click to design parts (and soon assemblies), but everything you make is really just [`kcl` code](https://github.com/KittyCAD/kcl-experiments) under the hood. All of your CAD models can be checked into source control such as GitHub and responsibly versioned, rolled back, and more.

The 3D view in Design Studio is just a video stream from our hosted geometry engine. The app sends new modeling commands to the engine via WebSockets, which returns back video frames of the view within the engine.

## Tools

- UI
  - [React](https://react.dev/)
  - [Headless UI](https://headlessui.com/)
  - [TailwindCSS](https://tailwindcss.com/)
  - [XState](https://xstate.js.org/)
- Networking
  - WebSockets (via [KittyCAD TS client](https://github.com/KittyCAD/kittycad.ts))
- Code Editor
  - [CodeMirror](https://codemirror.net/)
  - Custom WASM LSP Server
- Modeling
  - [KittyCAD TypeScript client](https://github.com/KittyCAD/kittycad.ts)

[Original demo video](https://drive.google.com/file/d/183_wjqGdzZ8EEZXSqZ3eDcJocYPCyOdC/view?pli=1)

[Original demo slides](https://github.com/user-attachments/files/19010536/demo.pdf)

## Get started

We recommend downloading the latest application binary from [our Releases page](https://github.com/KittyCAD/modeling-app/releases). If you don't see your platform or architecture supported there, please file an issue.

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

The Copilot LSP plugin in the editor requires a Zoo API token to run. In production, we authenticate this with a token via cookie in the browser and device auth token in the desktop environment, but this token is inaccessible in the dev browser version because the cookie is considered "cross-site" (from `localhost` to `dev.zoo.dev`). There is an optional environment variable called `VITE_KC_DEV_TOKEN` that you can populate with a dev token in a `.env.development.local` file to not check it into Git, which will use that token instead of other methods for the LSP service.

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
npm start # or npm run build:local && npm run serve for slower but more production-like build
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

You will need a `./e2e/playwright/playwright-secrets.env` file:

```bash
$ touch ./e2e/playwright/playwright-secrets.env
$ cat ./e2e/playwright/playwright-secrets.env
token=<dev.zoo.dev/account/api-tokens>
snapshottoken=<zoo.dev/account/api-tokens>
```
or use `export` to set the environment variables `token` and `snapshottoken`.

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

**Dependencies**

- `KITTYCAD_API_TOKEN`
- `cargo-nextest`
- `just`

#### Setting KITTYCAD_API_TOKEN

Use the production zoo.dev token, set this environment variable before running the tests

#### Installing cargonextest

```
cd rust 
cargo search cargo-nextest
cargo install cargo-nextest
```

#### just

install [`just`](https://github.com/casey/just?tab=readme-ov-file#pre-built-binaries)

#### Running the tests

```bash
# With just
# Make sure KITTYCAD_API_TOKEN=<prod zoo.dev token> is set
# Make sure you installed cargo-nextest
# Make sure you installed just
cd rust 
just test
```

```bash
# Without just
# Make sure KITTYCAD_API_TOKEN=<prod zoo.dev token> is set
# Make sure you installed cargo-nextest
cd rust 
export RUST_BRACKTRACE="full" && cargo nextest run --workspace --test-threads=1
```

Where `XXX` is an API token from the production engine (NOT the dev environment).

We recommend using [nextest](https://nexte.st/) to run the Rust tests (its faster and is used in CI). Once installed, run the tests using

```
cd rust 
KITTYCAD_API_TOKEN=XXX cargo run nextest
```

### Mapping CI CD jobs to local commands

When you see the CI CD fail on jobs you may wonder three things

- Do I have a bug in my code?
- Is the test flaky?
- Is there a bug in `main`?

To answer these questions the following commands will give you confidence to locate the issue.

#### Static Analysis

Part of the CI CD pipeline performs static analysis on the code. Use the following commands to mimic the CI CD jobs.

The following set of commands should get us closer to one and done commands to instantly retest issues.

```
npm run test-setup
```

> Gotcha, are packages up to date and is the wasm built?

```
npm run tsc
npm run fmt:check
npm run lint
npm run test:unit:local
```

> Gotcha: Our unit tests have integration tests in them. You need to run a localhost server to run the unit tests.

#### E2E Tests

**Playwright Electron**

These E2E tests run in electron. There are tests that are skipped if they are ran in a windows, linux, or macos environment. We can use playwright tags to implement test skipping.

```
npm run test:playwright:electron:local
npm run test:playwright:electron:windows:local
npm run test:playwright:electron:macos:local
npm run test:playwright:electron:ubuntu:local
```

> Why does it say local? The CI CD commands that run in the pipeline cannot be ran locally. A single command will not properly setup the testing environment locally.

#### Some notes on CI

The tests are broken into snapshot tests and non-snapshot tests, and they run in that order, they automatically commit new snap shots, so if you see an image commit check it was an intended change. If we have non-determinism in the snapshots such that they are always committing new images, hopefully this annoyance makes us fix them asap, if you notice this happening let Kurt know. But for the odd occasion `git reset --hard HEAD~ && git push -f` is your friend.

How to interpret failing playwright tests?
If your tests fail, click through to the action and see that the tests failed on a line that includes `await page.getByTestId('loading').waitFor({ state: 'detached' })`, this means the test fail because the stream never started. It's you choice if you want to re-run the test, or ignore the failure.

We run on ubuntu and macos, because safari doesn't work on linux because of the dreaded "no RTCPeerConnection variable" error. But linux runs first and then macos for the same reason that we limit the number of parallel tests to 1 because we limit stream connections per user, so tests would start failing we if let them run together.

If something fails on CI you can download the artifact, unzip it and then open `playwright-report/data/<UUID>.zip` with https://trace.playwright.dev/ to see what happened.

#### Getting started writing a playwright test in our app

Besides following the instructions above and using the playwright docs, our app is weird because of the whole stream thing, which means our testing is weird. Because we've just figured out this stuff and therefore docs might go stale quick here's a 15min vid/tutorial

https://github.com/KittyCAD/modeling-app/assets/29681384/6f5e8e85-1003-4fd9-be7f-f36ce833942d

<details>

<summary>
PS: for the debug panel, the following JSON is useful for snapping the camera
</summary>

```JSON
{"type":"modeling_cmd_req","cmd_id":"054e5472-e5e9-4071-92d7-1ce3bac61956","cmd":{"type":"default_camera_look_at","center":{"x":15,"y":0,"z":0},"up":{"x":0,"y":0,"z":1},"vantage":{"x":30,"y":30,"z":30}}}
```

</details>

## KCL

For how to contribute to KCL, [see our KCL README](https://github.com/KittyCAD/modeling-app/tree/main/rust/kcl-lib).

### Logging

To display logging (to the terminal or console) set `ZOO_LOG=1`. This will log some warnings and simple performance metrics. To view these in test runs, use `-- --nocapture`.

To enable memory metrics, build with `--features dhat-heap`.
