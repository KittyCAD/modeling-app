# Contributor Guide

## Installing dependencies

Install a node version manager such as [fnm](https://github.com/Schniz/fnm?tab=readme-ov-#installation).

On Windows, it's also recommended to [upgrade your PowerShell version](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows?view=powershell-7.5#winget), we're using 7.

Then in the repo run the following to install and use the node version specified in `.nvmrc`. You might need to specify your processor architecture with `--arch arm64` or `--arch x64` if it's not autodetected.

```
fnm install
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

## Building the app

To build the WASM layer, run:

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

Finally, to build the desktop app locally, pointing to the the production infra (which is accessible by everyone), run:

```
npm run tronb:package:prod
```

This will use electron-builder to generate installable artifacts in the `out` directory (eg. `Zoo Design Studio.app` on macOS and `Zoo Design Studio.exe` on Windows). The regular sign-in flow should work as expected.

### Development environment variables

The Copilot LSP plugin in the editor requires a Zoo API token to run. In production, we authenticate this with a token via cookie in the browser and device auth token in the desktop environment, but this token is inaccessible in the dev browser version because the cookie is considered "cross-site" (from `localhost` to `zoo.dev`). There is an optional environment variable called `VITE_ZOO_API_TOKEN` that you can populate with a dev token in a `.env.development.local` file to not check it into Git, which will use that token instead of other methods for the LSP service.

### Developing in the browser

If you're not a Zoo employee, modeling commands are **billable** when running in
the browser during local development! This is also true of non-Electron
web-based tests that use the production API for modeling commands.

To work around this, you must develop using Electron.

### Developing with Electron

To spin up the desktop app, `npm install` and `npm run build:wasm` need to have been done before hand then:

```
npm run tron:start
```

This will start the application and hot-reload on changes.

Note that it leverages a web server and by default points to our non-production dev.zoo.dev infrastructure, which isn't accessible to everyone. Refer to _Building the app_ if `tron:start` doesnt work for you.

Devtools can be opened with the usual Command-Option-I (macOS) or Ctrl-Shift-I (Linux and Windows).

## Running tests

### Playwright tests

Prepare these system dependencies:

- Set `$VITE_ZOO_API_TOKEN` from https://zoo.dev/account/api-tokens

#### Desktop tests (Electron on all platforms)

```
npm run playwright -- install chromium
npm run test:e2e:desktop:local
```

You may use `-- -g "my test"` to match specific test titles, or `-- path/to/file.spec.ts` for a test file.

#### Web tests (Google Chrome on all platforms)

```
npm run test:e2e:web
```

#### Snapshot tests (Google Chrome on Ubuntu only)

If you are running Ubuntu locally, in a VM, or using GitHub Codespaces:

```
npm run playwright -- install chrome
npm run test:snapshots
```

Append `-- --update-snapshots` if you made significant UI changes.

Alternatively, you can simply delete `e2e/playwright/snapshot-tests.spec.ts-snapshots/` to let the GitHub Actions job create a fresh snapshots commit automatically.

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

### Unit and integration tests

If you already haven't, run the following:

```
npm
npm run build:wasm
npm start
```

and finally:

```
npm run test
```

For individual testing:

```
npm run test abstractSyntaxTree -t "unexpected closed curly brace" --silent=false
```

Which will run our suite of [Vitest unit](https://vitest.dev/) and [React Testing Library E2E](https://testing-library.com/docs/react-testing-library/intro) tests, in interactive mode by default.

### Rust tests

Prepare these system dependencies:

- Set `$ZOO_API_TOKEN` from https://zoo.dev/account/api-tokens
- Install `just` following [these instructions](https://just.systems/man/en/packages.html)

then run tests that target the KCL language:

```
npm run test:e2e:kcl
```

### Fuzzing the parser

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

### Logging

To display logging (to the terminal or console) set `ZOO_LOG=1`. This will log some warnings and simple performance metrics. To view these in test runs, use `-- --nocapture`.

To enable memory metrics, build with `--features dhat-heap`.

## Running scripts

There are multiple scripts under the folder path `./scripts` which can be used in various settings.

### Pattern for a static file, npm run commands, and CI-CD checks

If you want to implement a static checker follow this pattern. Two static checkers we have are circular dependency checks in our typescript code and url checker to see if any hard coded URL is the typescript application 404s. We have a set of known files in `./scripts/known/*.txt` which is the baseline.

If you improve the baseline, run the overwrite command and commit the new smaller baseline. Try not to make the baseline bigger, the CI CD will complain.
These baselines are to hold us to higher standards and help implement automated testing against the repository

#### Output result to stdout
- `npm run circular-deps`
- `npm run url-checker`

- create a `<name>.sh` file that will run the static checker then output the result to `stdout`

#### Overwrite result to known .txt file on disk

If the application needs to overwrite the known file on disk use this pattern. This known .txt file will be source controlled as the baseline

- `npm run circular-deps:overwrite`
- `npm run url-checker:overwrite`

#### Diff baseline and current

These commands will write a /tmp/ file on disk and compare it to the known file in the repository. This command will also be used in the CI CD pipeline for automated checks

- create a `diff-<name>.sh` file that is the script to diff your tmp file to the baseline
e.g. `diff-url-checker.sh`
```bash
#!/bin/bash
set -euo pipefail

npm run url-checker > /tmp/urls.txt
diff --ignore-blank-lines -w /tmp/urls.txt ./scripts/known/urls.txt
```

- `npm run circular-deps:diff`
- `npm run url-checker:diff`

## Proposing changes

Before you submit a contribution PR to this repo, please ensure that:

- There is a corresponding issue for the changes you want to make, so that discussion of approach can be had before work begins.
- You have separated out refactoring commits from feature commits as much as possible
- You have run all of the following commands locally:
  - `npm run fmt`
  - `npm run tsc`
  - `npm run test`
  - Here they are all together: `npm run fmt && npm run tsc && npm run test`

## Shipping releases

Create a new issue using the **Release** issue template: https://github.com/KittyCAD/modeling-app/issues/new?template=release.md

Follow the embedded instructions to facilitate changelog discussions and release testing.
