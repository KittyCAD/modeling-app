---
title: "KCL Modules"
excerpt: "Documentation of modules for the KCL language for the Zoo Design Studio."
layout: manual
---

`KCL` allows splitting code up into multiple files.  Each file is somewhat
isolated from other files as a separate module.

When you define a function, you can use `export` before it to make it available
to other modules.

```
// util.kcl
export fn increment(x) {
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

Imported files _must_ be in the same project so that units are uniform across
modules. This means that it must be in the same directory.

Import statements must be at the top-level of a file. It is not allowed to have
an `import` statement inside a function or in the body of an if-else.

Multiple functions can be exported in a file.

```
// util.kcl
export fn increment(x) {
  return x + 1
}

export fn decrement(x) {
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

## Importing files from other CAD systems

`import` can also be used to import files from other CAD systems. The format of the statement is the
same as for KCL files. You can only import the whole file, not items from it. E.g.,

```norun
import "tests/inputs/cube.obj"

// Use `cube` just like a KCL object.
```

```norun
import "tests/inputs/cube-2.sldprt" as cube

// Use `cube` just like a KCL object.
```

You can make the file format explicit using a format attribute (useful if using a different
extension), e.g.,

```norun
@(format = obj)
import "tests/inputs/cube"
```

For formats lacking unit data (such as STL, OBJ, or PLY files), the default
unit of measurement is millimeters. Alternatively you may specify the unit
by using an attirbute. Likewise, you can also specify a coordinate system. E.g.,

```norun
@(unitLength = ft, coords = opengl)
import "tests/inputs/cube.obj"
```

When importing a GLTF file, the bin file will be imported as well.

Import paths are relative to the current project directory. Imports currently only work when
using the native Design Studio, not in the browser.

### Supported values

File formats: `fbx`, `gltf`/`glb`, `obj`+, `ply`+, `sldprt`, `step`/`stp`, `stl`+. (Those marked with a
'+' support customising the length unit and coordinate system).

Length units: `mm` (the default), `cm`, `m`, `inch`, `ft`, `yd`.

Coordinate systems:

- `zoo` (the default), forward: -Y, up: +Z, handedness: right
- `opengl`, forward: +Z, up: +Y, handedness: right
- `vulkan`, forward: +Z, up: -Y, handedness: left

### Performance

Parallelized foreign-file imports now let you overlap file reads, initialization,
and rendering. To maximize throughput, you need to understand the three distinct
stages—reading, initializing (background render start), and invocation (blocking)
—and structure your code to defer blocking operations until the end.

#### Foreign Import Execution Stages

1. **Import (Read) Stage**  
   ```norun
   import "tests/inputs/cube.step" as cube
   ```  
   - Reads the file from disk and makes its API available.  
   - **Does _not_** start Engine rendering or block your script.

2. **Initialization (Background Render) Stage**  
   ```norun
   import "tests/inputs/cube.step" as cube

   myCube = cube    // <- This line starts background rendering
   ```  
   - Invoking the imported symbol (assignment or plain call) triggers Engine rendering _in the background_.  
   - This kick‑starts the render pipeline but doesn’t block—you can continue other work while the Engine processes the model.

3. **Invocation (Blocking) Stage**  
   ```norun
   import "tests/inputs/cube.step" as cube

   myCube = cube

   myCube
    |> translate(z=10) // <- This line blocks
   ```  
   - Any method call (e.g., `translate`, `scale`, `rotate`) waits for the background render to finish before applying transformations.  
   - This is the only point where your script will block.

> **Nuance:**  Foreign imports differ from pure KCL modules—calling the same import symbol multiple times (e.g., `screw` twice) starts background rendering twice.

#### Best Practices

##### 1. Defer Blocking Calls
Initialize early but delay all transformations until after your heavy computation:
```norun
import "tests/inputs/cube.step" as cube     // 1) Read

myCube = cube                               // 2) Background render starts


// --- perform other operations and calculations or setup here ---


myCube
  |> translate(z=10)                        // 3) Blocks only here
```

##### 2. Encapsulate Imports in Modules
Keep `main.kcl` free of reads and initialization; wrap them:

```norun
// imports.kcl
import "tests/inputs/cube.step" as cube    // Read only


export myCube = cube                      // Kick off rendering
```

```norun
// main.kcl
import myCube from "imports.kcl"  // Import the initialized object 


// ... computations ...


myCube
  |> translate(z=10)              // Blocking call at the end
```

##### 3. Avoid Immediate Method Calls

```norun
import "tests/inputs/cube.step" as cube

cube
  |> translate(z=10)              // Blocks immediately, negating parallelism
```

Both calling methods right on `cube` immediately or leaving an implicit import without assignment introduce blocking.

#### Future Improvements

Upcoming releases will auto‑analyze dependencies and only block when truly necessary. Until then, explicit deferral and modular wrapping give you the best performance.

