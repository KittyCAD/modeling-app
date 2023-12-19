![Zoo Modeling App](/public/zma-logomark-outlined.png)

## Zoo Modeling App

live at [app.zoo.dev](https://app.zoo.dev/)

A CAD application from the future, brought to you by the [Zoo team](https://zoo.dev).

Modeling App is our take on what a modern modelling experience can be. It is applying several lessons learned in the decades since most major CAD tools came into existence:

- All artifacts—including parts and assemblies—should be represented as human-readable code. At the end of the day, your CAD project should be "plain text"
  - This makes version control—which is a solved problem in software engineering—trivial for CAD
- All GUI (or point-and-click) interactions should be actions performed on this code representation under the hood
  - This unlocks a hybrid approach to modeling. Whether you point-and-click as you always have or you write your own KCL code, you are performing the same action in Modeling App
- Everything graphics _has_ to be built for the GPU
  - Most CAD applications have had to retrofit support for GPUs, but our geometry engine is made for GPUs (primarily Nvidia's Vulkan), getting the order of magnitude rendering performance boost with it
- Make the resource-intensive pieces of an application auto-scaling
  - One of the bottlenecks of today's hardware design tools is that they all rely on the local machine's resources to do the hardest parts, which include geometry rendering and analysis. Our geometry engine parallelizes rendering and just sends video frames back to the app (seriously, inspect source, it's just a `<video>` element), and our API will offload analysis as we build it in

We are excited about what a small team of people could build in a short time with our API. We welcome you to try our API, build your own applications, or contribute to ours!

Modeling App is a _hybrid_ user interface for CAD modeling. You can point-and-click to design parts (and soon assemblies), but everything you make is really just [`kcl` code](https://github.com/KittyCAD/kcl-experiments) under the hood. All of your CAD models can be checked into source control such as GitHub and responsibly versioned, rolled back, and more.

The 3D view in Modeling App is just a video stream from our hosted geometry engine. The app sends new modeling commands to the engine via WebSockets, which returns back video frames of the view within the engine.

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

[Original demo slides](https://github.com/KittyCAD/Eng/files/10398178/demo.pdf)

## Get started

We recommend downloading the latest application binary from [our Releases page](https://github.com/KittyCAD/modeling-app/releases). If you don't see your platform or architecture supported there, please file an issue.

## Running a development build

First, [install Rust via `rustup`](https://www.rust-lang.org/tools/install). This project uses a lot of Rust compiled to [WASM](https://webassembly.org/) within it. We always use the latest stable version of Rust, so you may need to run `rustup update stable`. Then, run:

```
yarn install
```

followed by:

```
yarn build:wasm-dev
```

That will build the WASM binary and put in the `public` dir (though gitignored)

finally, to run the web app only, run:

```
yarn start
```

## Developing in Chrome

Chrome is in the process of rolling out a new default which
[blocks Third-Party Cookies](https://developer.chrome.com/en/docs/privacy-sandbox/third-party-cookie-phase-out/).
If you're having trouble logging into the `modeling-app`, you may need to
enable third-party cookies. You can enable third-party cookies by clicking on
the eye with a slash through it in the URL bar, and clicking on "Enable
Third-Party Cookies".

## Running tests

First, start the dev server following "Running a development build" above.

Then in another terminal tab, run:

```
yarn test
```

Which will run our suite of [Vitest unit](https://vitest.dev/) and [React Testing Library E2E](https://testing-library.com/docs/react-testing-library/intro/) tests, in interactive mode by default.

For running the rust (not tauri rust though) only, you can
```bash
cd src/wasm-lib
cargo test
```
but you will need to have install ffmpeg prior to.

## Tauri

To spin up up tauri dev, `yarn install` and `yarn build:wasm-dev` need to have been done before hand then

```
yarn tauri dev
```

Will spin up the web app before opening up the tauri dev desktop app. Note that it's probably a good idea to close the browser tab that gets opened since at the time of writing they can conflict.

The dev instance automatically opens up the browser devtools which can be disabled by [commenting it out](https://github.com/KittyCAD/modeling-app/blob/main/src-tauri/src/main.rs#L92.)

To build, run `yarn tauri build`, or `yarn tauri build --debug` to keep access to the devtools.

Note that these became separate apps on Macos, so make sure you open the right one after a build 😉
![image](https://github.com/KittyCAD/modeling-app/assets/29681384/a08762c5-8d16-42d8-a02f-a5efc9ae5551)

<img width="1232" alt="image" src="https://user-images.githubusercontent.com/29681384/211947063-46164bb4-7bdd-45cb-9a76-2f40c71a24aa.png">

<img width="1232" alt="image (1)" src="https://user-images.githubusercontent.com/29681384/211947073-e76b4933-bef5-4636-bc4d-e930ac8e290f.png">

## Before submitting a PR

Before you submit a contribution PR to this repo, please ensure that:

- There is a corresponding issue for the changes you want to make, so that discussion of approach can be had before work begins.
- You have separated out refactoring commits from feature commits as much as possible
- You have run all of the following commands locally:
  - `yarn fmt`
  - `yarn tsc`
  - `yarn test`
  - Here they are all together: `yarn fmt && yarn tsc && yarn test`

## Release a new version

1. Bump the versions in the .json files by creating a `Cut release v{x}.{y}.{z}` PR, committing the changes from

```bash
VERSION=x.y.z yarn run bump-jsons
```

The PR may serve as a place to discuss the human-readable changelog and extra QA. A quick way of getting PR's merged since the last bump is to [use this PR filter](https://github.com/KittyCAD/modeling-app/pulls?q=is%3Apr+sort%3Aupdated-desc+is%3Amerged+), open up the browser console and past in the following

```typescript
console.log(
  '- ' +
    Array.from(
      document.querySelectorAll('[data-hovercard-type="pull_request"]')
    ).map((a) => `[${a.innerText}](${a.href})`).join(`
- `)
)
```
grab the md list and delete any that are older than the last bump

2. Merge the PR

3. Create a new release and tag pointing to the bump version commit using semantic versioning `v{x}.{y}.{z}`

4. A new Action kicks in at https://github.com/KittyCAD/modeling-app/actions, uploading artifacts to the release

## Fuzzing the parser

Make sure you install cargo fuzz:

```bash
$ cargo install cargo-fuzz
```

```bash
$ cd src/wasm-lib/kcl

# list the fuzz targets
$ cargo fuzz list

# run the parser fuzzer
$ cargo +nightly fuzz run parser
```

For more information on fuzzing you can check out
[this guide](https://rust-fuzz.github.io/book/cargo-fuzz.html).


### Playwright

First time running plawright locally, you'll need to add the secrets file
```bash
touch ./e2e/playwright/playwright-secrets.env
echo 'token="your-token"\nsnapshottoken="your-snapshot-token"' > ./e2e/playwright/playwright-secrets2.env
```
then replace "your-token" with a dev token from dev.zoo.dev/account/api-tokens

then:
run playwright
```
yarn playwright test
```

run a specific test suite
```
yarn playwright test src/e2e-tests/example.spec.ts
```

run a specific test change the test from `test('...` to `test.only('...`
(note if you commit this, the tests will instantly fail without running any of the tests)

run headed
```
yarn playwright test --headed
```

run with step through debugger
```
PWDEBUG=1 yarn playwright test
```
However, if you want a debugger I recommend using VSCode and the `playwright` extension, as the above command is a cruder debugger that steps into every function call which is annoying.
With the extension you can set a breakpoint after `waitForDefaultPlanesVisibilityChange` in order to skip app loading, then the vscode debugger's "step over" is much better for being able to stay at the right level of abstraction as you debug the code.

If you want to limit to a single browser use `--project="webkit"` or `firefox`, `Google Chrome`
Or comment out browsers in `playwright.config.ts`.

note chromium has encoder compat issues which is why were testing against the branded 'Google Chrome'

You may consider using the VSCode extension, it's useful for running individual threads, but some some reason the "record a test" is locked to chromium with we can't use. A work around is to us the CI `yarn playwright codegen -b wk --load-storage ./store localhost:3000`

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

#### Some notes on CI

The tests are broken into snapshot tests and non-snapshot tests, and they run in that order, they automatically commit new snap shots, so if you see an image commit check it was an intended change. If we have non-determinism in the snapshots such that they are always committing new images, hopefully this annoyance makes us fix them asap, if you notice this happening let Kurt know. But for the odd occasion  `git reset --hard HEAD~ && git push -f` is your friend.

How to interpret failing playwright tests?
If your tests fail, click through to the action and see that the tests failed on a line that includes `await page.getByTestId('loading').waitFor({ state: 'detached' })`, this means the test fail because the stream never started. It's you choice if you want to re-run the test, or ignore the failure.

We run on ubuntu and macos, because safari doesn't work on linux because of the dreaded "no RTCPeerConnection variable" error. But linux runs first and then macos for the same reason that we limit the number of parallel tests to 1 because we limit stream connections per user, so tests would start failing we if let them run together.

If something fails on CI you can download the artifact, unzip it and then open `playwright-report/data/<UUID>.zip` with https://trace.playwright.dev/ to see what happened.

#### Getting started writing a playwright test in our app

Besides following the instructions above and using the playwright docs, our app is weird because of the whole stream thing, which means our testing is weird. Because we've just figured out this stuff and therefore docs might go stale quick here's a 15min vid/tutorial

https://github.com/KittyCAD/modeling-app/assets/29681384/6f5e8e85-1003-4fd9-be7f-f36ce833942d

<details>

<summary>
Ps for the debug panel, the following JSON is useful for snapping the camera
</summary>

```JSON
{"type":"modeling_cmd_req","cmd_id":"054e5472-e5e9-4071-92d7-1ce3bac61956","cmd":{"type":"default_camera_look_at","center":{"x":15,"y":0,"z":0},"up":{"x":0,"y":0,"z":1},"vantage":{"x":30,"y":30,"z":30}}}
```

</details>
