---
title: "Projects and modules"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

`KCL` allows splitting code up into multiple files.  Each file is somewhat
isolated from other files as a separate module.

When you define a function, you can use `export` before it to make it available
to other modules.

```kcl
// util.kcl
export fn increment(@x) {
  return x + 1
}
```

Other files in the project can now import functions that have been exported.
This makes them available to use in another file.

```norun
// main.kcl
import increment from "util.kcl"

answer = increment(41)
```

Import statements must be at the top-level of a file. It is not allowed to have
an `import` statement inside a function or in the body of an if‑else.

Multiple functions can be exported in a file.

```kcl
// util.kcl
export fn increment(@x) {
  return x + 1
}

export fn decrement(@x) {
  return x - 1
}
```

When importing, you can import multiple functions at once.

```norun
import increment, decrement from "util.kcl"
```

Imported symbols can be renamed for convenience or to avoid name collisions.

```norun
import increment as inc, decrement as dec from "util.kcl"
```

You can import files from the current directory or from subdirectories, but if importing from a
subdirectory you can only import `main.kcl`.

---

## Import path requirements

Some import paths require an alias because they cannot be used as valid identifiers. An alias is a custom name you provide using the `as` keyword.

You must provide an alias when the filename contains hyphens or starts with an underscore:

```kcl
import "my-part.kcl" as myPart
import "_internal.kcl" as internal
```

You must also provide an alias when the path contains relative directory components:

```kcl
import "../library/teardropHole.kcl" as teardropHole
import "./utils/helper.kcl" as helper
```

### Subdirectory restrictions

When importing from subdirectories, you can only import `main.kcl` files:

```kcl
import "library/main.kcl" as library
import "utils/main.kcl" as utils
```

```kcl
import "library/teardropHole.kcl"        // Error: "Import path to subdirectory can only refer to main.kcl"
import "utils/helper.kcl"                // Error: "Import path to subdirectory can only refer to main.kcl"
```

If you need to import a specific file from a subdirectory, you can move it to the current directory or use a symbolic link.

---

## Functions vs `clone`

There are two common patterns for re‑using geometry:

1. **Wrap the construction in a function** – flexible and fully parametric.
2. **Duplicate an existing object with `clone`** – lightning‑fast, but an exact
   duplicate.

### Parametric function example

```kcl
fn cube(center) {
  return startSketchOn(XY)
    |> startProfile(at = [center[0] - 10, center[1] - 10])
    |> line(endAbsolute = [center[0] + 10, center[1] - 10])
    |> line(endAbsolute = [center[0] + 10, center[1] + 10])
    |> line(endAbsolute = [center[0] - 10, center[1] + 10])
    |> close()
    |> extrude(length = 10)
}

myCube = cube(center = [0, 0])
```

*Pros*
- Any argument can be a parameter – size, position, appearance, etc.
- Works great inside loops, arrays, or optimisation sweeps.

*Cons*
- Every invocation rebuilds the entire feature tree.
- **Slower** than a straight duplicate – each call is its own render job.

### `clone` example

```kcl
sketch001 = startSketchOn(-XZ)
  |> circle(center = [0, 0], radius = 10)
  |> extrude(length = 5) 
  |> appearance(color = "#ff0000", metalness = 90, roughness = 90)

sketch002 = clone(sketch001)  // ✓ instant copy
```

*Pros*
- Roughly an O(1) operation – we just duplicate the underlying engine handle.
- Perfect when you need ten identical bolts or two copies of the same imported STEP file.

*Cons*
- **Not parametric** – the clone is exactly the same shape as the source.
- If you need to tweak dimensions per‑instance, you’re back to a function.

> **Rule of thumb** – Reach for `clone` when the geometry is already what you want. Reach for a function when you need customisation.

---

## Module‑level parallelism

Under the hood, the Design Studio runs **every module in parallel** where it can. This means:

- The top‑level code of `foo.kcl`, `bar.kcl`, and `baz.kcl` all start executing immediately and concurrently.
- Imports that read foreign files (STEP/OBJ/…) overlap their I/O and background render.
- CPU‑bound calculations in separate modules get their own worker threads.

### Why modules beat one‑big‑file

If you shoe‑horn everything into `main.kcl`, each statement runs sequentially:

```norun
import "big.step" as gizmo  // blocks main while reading

gizmo |> translate(x=50)    // blocks again while waiting for render
```

Split `gizmo` into its own file and the read/render can overlap whatever else `main.kcl` is doing.

```norun
// gizmo.kcl                   (worker A)
import "big.step"

// main.kcl                    (worker B)
import "gizmo.kcl" as gizmo   // non‑blocking

// ... other setup ...

gizmo |> translate(x=50)      // only blocks here
```

### Gotcha: defining but **not** calling functions

Defining a function inside a module is instantaneous – we just record the byte‑code. The heavy lifting happens when the function is **called**. So:

```norun
// util.kcl
export fn makeBolt(size) { /* … expensive CAD … */ }
```

If `main.kcl` waits until the very end to call `makeBolt`, *none* of that work was parallelised – you’ve pushed the cost back onto the serial tail of your script.

**Better:** call it early or move the invocation into another module.

```norun
// bolt_instance.kcl
import makeBolt from "util.kcl"
bolt = makeBolt(5)  // executed in parallel
bolt
```

Now `main.kcl` can `import "bolt_instance.kcl" as bolt` and get the result that was rendered while it was busy doing other things.

---

## Whole module import

You can also import the whole module. This is useful if you want to use the
result of a module as a variable, like a part.

```norun
import "cube.kcl"
cube
  |> translate(x=10)
```

This imports the whole module and makes it available as `cube`. You can then
use it like any other object. The `cube` variable is now a reference to the
result of the module. This means that if you change the module, the `cube`
variable will change as well.

In `cube.kcl`, you cannot have multiple objects. It has to be a single part. If
you have multiple objects, you will get an error. This is because the module is
expected to return a single object that can be used as a variable.

The last expression or variable definition becomes the module's return value.
The module is expected to return a single object that can be used as a variable
by whatever imports it.

So for example, this is allowed:

```norun
... a bunch of code to create cube and cube2 ...

myUnion = union([cube, cube2])
```

You can also do this:

```norun
... a bunch of code to create cube and cube2 ...

union([cube, cube2])
```

Either way, the last line will return the union of the two objects.

Or what you could do instead is:

```norun
... a bunch of code to create cube and cube2 ...

myUnion = union([cube, cube2])
myUnion
```

This will assign the union of the two objects to a variable, and then return it
on the last statement. It's simply another way of doing the same thing.

The final statement is what's important because it's the return value of the
entire module. The module is expected to return a single object that can be used
as a variable by the file that imports it.

The name of the file or subdirectory is used as the name of the variable within the importing program.
If you want to use a different name, you can do so by using the `as` keyword:

```kcl,norun
import "cube.kcl"                // Introduces a new variable called `cube`.
import "cube.kcl" as block       // Introduces a new variable called `block`.
import "cube/main.kcl"           // Introduces a new variable called `cube`.
import "cube/main.kcl" as block  // Introduces a new variable called `block`.
```

If the filename includes hyphens (`-`) or starts with an underscore (`_`), then you must specify a
variable name.

---

## Multiple instances of the same import

Whether you are importing a file from another CAD system or a KCL file, that
file represents object(s) in memory. If you import the same file multiple times,
it will only be rendered once.

If you want to have multiple instances of the same object, you can use the
[`clone`](/docs/kcl/clone) function. This will render a new instance of the object in memory.

```norun
import cube from "cube.kcl"

cube  
  |> translate(x=10)
clone(cube)
  |> translate(x=20)
```

In the sample above, the `cube` object is imported from a KCL file. The first
instance is translated 10 units in the x direction. The second instance is
cloned and translated 20 units in the x direction. The two instances are now
separate objects in memory, and can be manipulated independently.

Here is an example with a file from another CAD system:

```kcl
import "tests/inputs/cube.step"

cube
  |> translate(x=10)
clone(cube)
  |> translate(x=20)
```

---

## Common import errors

### "Import path is not a valid identifier and must be aliased"

This error occurs when the import path contains characters that cannot be used as a valid identifier. Add an alias:

```kcl
import "../library/teardropHole.kcl" as teardropHole
import "my-part.kcl" as myPart
```

### "Import path to subdirectory can only refer to main.kcl"

This error occurs when trying to import a specific file from a subdirectory. Import `main.kcl` instead:

```kcl
import "library/main.kcl" as library
```

Or move the file to the current directory:

```kcl
import "teardropHole.kcl" as teardropHole
```
