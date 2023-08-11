## Kurt demo project

live at [untitled-app.kittycad.io](https://untitled-app.kittycad.io/)

Not sure what to call this, it's both a language/interpreter and a UI that uses the language as the source of truth model the user build with direct-manipulation with the UI.

It might make sense to split this repo up at some point, but not the lang and the UI are all togther in a react app

Originally Presented on 10/01/2023

[Video](https://drive.google.com/file/d/183_wjqGdzZ8EEZXSqZ3eDcJocYPCyOdC/view?pli=1)

[demo-slides.pdf](https://github.com/KittyCAD/Eng/files/10398178/demo.pdf)

## To run, there are a couple steps since we're compiling rust to WASM, you'll need to have rust stuff installed, then

```
yarn install
```
then
```
yarn build:wasm
```
That will build the WASM binary and put in the `public` dir (though gitignored)

finally
```
yarn start
```

and `yarn test` you would have need to have built the WASM previously. The tests need to download the binary from a server, so if you've already got `yarn start` running, that will work, otherwise running
```
yarn simpleserver
```
in one terminal
and 
```
yarn test
```
in another.

If you want to edit the rust files, you can cd into `src/wasm-lib` and then use the usual rust commands, `cargo build`, `cargo test`, when you want to bring the changes back to the web-app, a fresh `yarn build:wasm` in the root will be needed.

Worth noting that the integration of the WASM into this project is very hacky because I'm really pushing create-react-app further than what's practical, but focusing on features atm rather than the setup.

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

## Release a new version

1. Bump the versions in the .json files by creating a `Bump to v{x}.{y}.{z}` PR, committing the changes from

```bash
VERSION=x.y.z yarn run bump-jsons
```
The PR may serve as a place to discuss the human-readable changelog and extra QA.

2. Merge the PR

3. Create a new release and tag pointing to the bump version commit using semantic versioning `v{x}.{y}.{z}`

4. A new Action kicks in at https://github.com/KittyCAD/modeling-app/actions, uploading artifacts to the release
