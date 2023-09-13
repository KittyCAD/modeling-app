![KittyCAD Modeling App](/public/kcma-logomark.png)

## KittyCAD Modeling App

live at [app.kittycad.io](https://app.kittycad.io/)

A CAD application from the future, brought to you by the [KittyCAD team](https://kittycad.io).

This is an example application of what a small team can build on top of the KittyCAD API. It is open source so that anyone can fork it, extend it, or learn from it. We hope it inspires you to build the hardware design tool you've always wanted to see in the world.

KittyCAD Modeling App is a *hybrid* user interface for CAD modeling. You can point-and-click to design parts (and soon assemblies), but everything you make is really just [`kcl` code](https://github.com/KittyCAD/kcl-experiments) under the hood. All of your CAD models can be checked into source control such as GitHub and responsibly versioned, rolled back, and more.

The 3D view in KittyCAD Modeling App is just a video stream from our hosted geometry engine. The app sends new modeling commands to the engine via WebSockets, which returns back video frames of the view within the engine.

## Tools

- UI
  - [React](https://react.dev/)
  - [Headless UI](https://headlessui.com/)
  - [TailwindCSS](https://tailwindcss.com/)
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

First, [install Rust via `rustup`](https://www.rust-lang.org/tools/install). This project uses a lot of Rust compiled to [WASM](https://webassembly.org/) within it. Then, run:

```
yarn install
```
followed by:
```
yarn build:wasm
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

## Tauri

To spin up up tauri dev, `yarn install` and `yarn build:wasm` need to have been done before hand then
```
yarn tauri dev
```
Will spin up the web app before opening up the tauri dev desktop app. Note that it's probably a good idea to close the browser tab that gets opened since at the time of writting they can conflict.

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

1. Bump the versions in the .json files by creating a `Bump to v{x}.{y}.{z}` PR, committing the changes from

```bash
VERSION=x.y.z yarn run bump-jsons
```
The PR may serve as a place to discuss the human-readable changelog and extra QA.

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
