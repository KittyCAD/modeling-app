# kcl-lib

Our language for defining geometry and working with our Geometry Engine efficiently. Short for KittyCAD Language, named after our Design API.

## Contributing a standard library function

We've built a lot of tooling to make contributing to KCL easier. If you are interested in contributing a new standard library function to KCL, here is the rough process:

1. Open just the folder in your editor of choice. VS Code, for example, struggles to run rust-analyzer on the entire modeling-app directory because it's such a turducken of TS and Rust code.
2. Find the definition for similar standard library functions in `./kcl/src/std` and place your new one near it or in the same category file.
3. Add your new code. A new standard library function consists of:
4. A `pub async` of the actual standard library function in Rust
5. A doc comment block containing at least one example using your new standard library function (the Rust compiler will error if you don't provide an example our teammates are dope)
6. A `stdlib` macro providing the name that will need to be written by KCL users to use the function (this is usually a camelCase version of your Rust implementation, which is named with snake_case)
7. An inner function that is published only to the crate
8. Add your new standard library function to [the long list of CORE_FNS in mod.rs](https://github.com/KittyCAD/modeling-app/blob/main/rust/kcl-lib/src/std/mod.rs#L42)
9. Get a production Zoo dev token and run `export KITTYCAD_API_TOKEN=your-token-here` in a terminal
10. Run `TWENTY_TWENTY=overwrite cargo nextest run --workspace --no-fail-fast` to take snapshot tests of your example code running in the engine
11. Run `just redo-kcl-stdlib-docs` to generate new Markdown documentation for your function that will be used [to generate docs on our website](https://zoo.dev/docs/kcl).
12. Create a PR in GitHub.

## Making a Simulation Test

If you have KCL code that you want to test, simulation tests are the preferred way to do that.

Make a new sim test. Replace `foo_bar` with the snake case name of your test. The name needs to be unique.

```shell
just new-sim-test foo_bar
```

It will show the commands it ran, including the path to a new file `foo_bar/input.kcl`. Edit that with your KCL. If you need additional KCL files to import, include them in this directory.

Then run it.

```shell
just overwrite-sim-test foo_bar
```

The above should create a bunch of output files in the same directory.

Make sure you actually look at them. Specifically, if there's an `execution_error.snap`, it means the execution failed. Depending on the test, this may be what you expect. But if it's not, delete the snap file and run it again.

When it looks good, commit all the files, including `input.kcl`, generated output files in the test directory, and changes to `simulation_tests.rs`.

## Bumping the version

If you bump the version of kcl-lib and push it to crates, be sure to update the repos we own that use it as well. These are:

- [cli](https://github.com/kittycad/cli)
