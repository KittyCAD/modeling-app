# kcl-lib

Our language for defining geometry and working with our Geometry Engine efficiently. Short for KittyCAD Language, named after our Design API.

# Adding a new stdlib function

KCL's standard library lets users execute all the geometry functions they need to build their models, plus a bunch of other helpful utilities.

First, a few things to explain:

 - The KCL stdlib is declared in KCL. Its declarations are stored in KCL files, in the
   `kcl-lib/std/` directory.
 - KCL stdlib functions can be _implemented_ in either KCL or Rust. They're _declared_ in KCL,
   but can be implemented in Rust. This is pretty common in programming languages, it's like FFI, or using a JavaScript definition of an API actually implemented in the browser's C++ native library.
 - All KCL stdlib functions must have examples. In the guide below you'll see how to declare examples in KCL. All examples generate Rust tests, which you can run to ensure your KCL function works properly. The images and 3D models of these functions become assets in our docs.
 - KCL stdlib is divided into modules.

OK, let's start. Let's assume we're adding a new stdlib function called `cube`.

 - Choose which KCL stdlib module should contain your function.
   For the sake of example, we'll choose `solid`. It's in `solid.kcl`
 - Decide: is this KCL function's body implemented in Rust, or in KCL? If all it's doing is calling other KCL functions, you can write its body in KCL. If it needs to do something more complex, like parsing data or sending engine commands, you'll need to implement its body in Rust. In this example, we'll assume you're implementing it in Rust.
 - Write your new KCL function, declaring its type signature. Something like this:
  ```
  /// Document your function here in this docstring.
  @(impl = std_rust, feature_tree = true, experimental = true, added_in = "3.0-preview")
  export fn cube(
    /// Docstring for the first argument
    @sketch: Sketch,
    /// Docstring for the second argument
    /// This one is optional (hence the ?),
    /// and declares a default too (10).
    sideLength?: number(Length) = 10,
  ): Solid {}
  ```
  Note that its body is empty because the body will be defined in Rust.
  If you don't want this to show up in the ZDS feature tree, set `feature_tree = false` instead.
 - Add one or more examples of how to use it, in a docstring above the function.
  ```
  /// Document your function here in this docstring.
  /// ```kcl,sketchSolve
  /// // Here's an example of using the 'cube' function.
  /// @settings(kclVersion = "3.0-preview", experimentalFeatures = allow)
  /// myCube = cube(mySketch, sideLength = 123)
  /// ```
  @(impl = std_rust, feature_tree = true)
  export fn cube(
    /// Docstring for the first argument
    @sketch: Sketch,
    /// Docstring for the second argument
    /// This one is optional (hence the ?),
    /// and declares a default too (10).
    sideLength?: number(Length) = 10,
  ): Solid {}
  ```
 - Check that your new stdlib function can be reached from the KCL stdlib root. In all programming languages, the 'prelude' is the subset of the stdlib that automatically gets imported to the top level namespace of the user's file. Let's open `prelude.kcl` and make sure the user can reach your new function. In our case, everything added to `solid.kcl` is already imported, thanks to the `export import * from "std::solid"` line. So we're OK here. If your chosen module doesn't have a `export import * from "std::myModule"`, you'll need to add something. Look at the other examples in prelude.kcl or ask for help if you need it. When you run your tests (next step), it'll tell you if you got this wrong, because the KCL example program will error.
 - For each example you added, open up `kcl-derive-docs/src/example_tests.rs` and update `const TEST_NAMES` by adding a new entry. E.g. we would add a new line "std-solid-cube-0". The schema is 'std' then the KCL stdlib module name (we chose 'solid'), then your function name, then the
   index of each example (we only added one example, so its index is 0. If we added 3 examples, we'd add std-solid-cube-1 and std-solid-cube-2 as well).
 - Write the Rust function that your KCL stdlib function will call. Let's add it under `kcl-lib/src/std/solid_shapes.rs`. We'll copy how the `loft` function in `std/loft.rs` works. First write a `pub async fn cube` which parses KCL values from the arguments, and a `fn inner_cube` which uses those arguments to do something (creating new KCL values, sending to the engine, whatever). Your `cube` function should call `inner_cube` with the argument it parsed.
 - Open up `kcl-lib/src/std/mod.rs` and find `fn std_fn`. This big `match` statement maps your KCL stdlib functions to their Rust implementations. Add a new match arm, something like
   ```rust
   // First string here is the KCL module, second string is the KCL function.
   ("solid", "cube") => (
       // `crate::std::solid_shapes::cube` is the fully-qualified Rust reference
       // to the Rust function for the stdlib body.
       |e, a| Box::pin(crate::std::solid_shapes::cube(e, a).map(|r| r.map(KclValue::continue_))),
       // This string is the fully-qualified name of the KCL function.
       StdFnProps::default("std::solid::cube"),
   ),
   ```
 - Run your new examples: `TWENTY_TWENTY=overwrite cargo nextest run -- docs::kcl_doc::test::kcl_test_examples_std_solid_cube_0`.
  - This Rust test is generated from your KCL examples.
  - The part after -- is a regex filter for the tests. So if you want to run all your examples, you can use `kcl_test_examples_std_solid_cube` (no index, i.e. no 0) and it'll run all your examples, whether they end in _0, _1 etc.
  - This will run the examples and take both 2D and 3D snapshots, to store in the KCL docs.
 - Before finishing, run `just redo-kcl-stdlib-docs-no-imgs` to generate the docs for your new function.

## Making a Simulation Test

KCL's simulation test suite are our preferred way to test KCL. Each simulation test is a KCL project (one or more KCL files, and optionally other CAD files to import), which is the test's _input_. When the test is run, it creates _output_ artifacts, e.g. a map of all variables in program memory, a 2D graphic showing the final model, a 3D rendering of the model, a list of all Zoo Engine commands executed, etc. The output artifacts are compared with the artifacts already on disk. If they're different, the test fails (unless you explicitly overwrite the old artifacts). This helps ensure that changes to the KCL runtime won't break existing KCL files in user projects. You can also use this to test new features and ensure they won't break in the future.

First, make a new sim test. Replace `foo_bar` with the snake case name of your test. The name needs to be unique.

```shell
just new-sim-test foo_bar
```

The `just` command will show the shell commands it ran, including the path to a new file `foo_bar/input.kcl`. Edit that with your KCL. If you need additional KCL or STEP files to import, include them in this directory, next to `input.kcl`.

Then run it. First make sure you have `$ZOO_API_TOKEN` set, then:

```shell
just overwrite-sim-test foo_bar
```

The above should create a bunch of output files in the same directory.

Make sure you actually look at them. Specifically, if there's an `execution_error.snap`, it means the execution failed. Depending on the test, this may be what you expect. But if it's not, delete the snap file and run it again.

When it looks good, commit all the files, including `input.kcl`, generated output files in the test directory, and changes to `simulation_tests.rs`.

## Bumping the version

If you bump the version of kcl-lib and push it to crates, be sure to update the repos we own that use it as well. These are:

- [cli](https://github.com/kittycad/cli)
