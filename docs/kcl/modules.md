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

## Whole module import

You can also import the whole module. This is useful if you want to use the
result of a module as a variable, like a part. 

```norun
import "tests/inputs/cube.kcl" as cube
cube
  |> translate(x=10)
```

This imports the whole module and makes it available as `cube`. You can then
use it like any other object. The `cube` variable is now a reference to the
result of the module. This means that if you change the module, the `cube`
variable will change as well.

One important aspect of this is that the module must return a single object. If
it returns multiple objects, you will get an error. This is because the
imported module is expected to return a single object that can be used as a
variable.

You cannot call `export` on the part that you want to use as a variable. This is
because the module is expected to return a single object that can be used as a
variable. If you want to use multiple objects from a module, you can use 
`import thing, thing2 from "module.kcl"` to import them.



## Multiple instances of the same import

Whether you are importing a file from another CAD system or a KCL file, that
file represents object(s) in memory. If you import the same file multiple times,
it will only be rendered once.

If you want to have multiple instances of the same object, you can use the
[`clone`](/docs/kcl/clone) function. This will render a new instance of the object in memory.

```norun
import cube from "tests/inputs/cube.kcl"

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

```
import "tests/inputs/cube.step" as cube

cube
  |> translate(x=10)
clone(cube)
  |> translate(x=20)
```


## Importing files from other CAD systems

`import` can also be used to import files from other CAD systems. The format of the statement is the
same as for KCL files. You can only import the whole file, not items from it. E.g.,

```norun
import "tests/inputs/cube.obj"

// Use `cube` just like a KCL object.
```

```
import "tests/inputs/cube.sldprt" as cube

// Use `cube` just like a KCL object.
```

For formats lacking unit data (such as STL, OBJ, or PLY files), the default
unit of measurement is millimeters. Alternatively you may specify the unit
by using an attirbute. Likewise, you can also specify a coordinate system. E.g.,

```
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

1. **Import (Read/Initialization) Stage**  
   ```
   import "tests/inputs/cube.step" as cube
   ```  
   - Reads the file from disk and makes its API available.  
   - Starts engine rendering or block your script.
   - This kick‑starts the render pipeline but doesn’t block—you can continue other work while the Engine processes the model.

2. **Invocation (Blocking) Stage**  
   ```
   import "tests/inputs/cube.step" as cube

   cube
    |> translate(z=10) // <- This line blocks
   ```  
   - Any method call (e.g., `translate`, `scale`, `rotate`) waits for the background render to finish before applying transformations.  
   - This is the only point where your script will block.

#### Best Practices

##### 1. Defer Blocking Calls
Initialize early but delay all transformations until after your heavy computation:
```kcl
import "tests/inputs/cube.step" as cube     // 1) Read / Background render starts


// --- perform other operations and calculations or setup here ---


cube
  |> translate(z=10)                        // 2) Blocks only here
```

#### Future Improvements

Upcoming releases will auto‑analyze dependencies and only block when truly necessary. Until then, explicit deferral will give you the best performance.

