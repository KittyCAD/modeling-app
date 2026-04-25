---
title: "Importing geometry from other CAD systems"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

`import` can also be used to import files from other CAD systems. The format of the statement is the
same as for KCL files. You can only import the whole file, not items from it. E.g.,

```norun
import "tests/inputs/cube.obj"

// Use `cube` just like a KCL object.
```

```kcl
import "tests/inputs/cube.sldprt" as cube

// Use `cube` just like a KCL object.
```

For formats lacking unit data (such as STL, OBJ, or PLY files), the default
unit of measurement is millimeters. Alternatively you may specify the unit
by using an attribute. Likewise, you can also specify a coordinate system. E.g.,

```kcl
@(lengthUnit = ft, coords = opengl)
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

---

## Performance deep‑dive for foreign‑file imports

Parallelized foreign‑file imports now let you overlap file reads, initialization,
and rendering. To maximize throughput, you need to understand the three distinct
stages—reading, initializing (background render start), and invocation (blocking)
—and structure your code to defer blocking operations until the end.

### Foreign import execution stages

1. **Import (Read / Initialization) Stage**
   ```kcl
   import "tests/inputs/cube.step" as cube
   ```
   - Reads the file from disk and makes its API available.
   - Starts engine rendering but **does not block** your script.
   - This kick‑starts the render pipeline while you keep executing other code.

2. **Invocation (Blocking) Stage**
   ```kcl
   import "tests/inputs/cube.step" as cube

   cube
     |> translate(z=10) // ← blocks here only
   ```
   - Any method call (e.g., `translate`, `scale`, `rotate`) waits for the background render to finish before applying transformations.

### Best practices

#### 1. Defer blocking calls

```kcl
import "tests/inputs/cube.step" as cube     // 1) Read / Background render starts


// --- perform other operations and calculations here ---


cube
  |> translate(z=10)                        // 2) Blocks only here
```

#### 2. Split heavy work into separate modules

Place computationally expensive or IO‑heavy work into its own module so it can render in parallel while `main.kcl` continues.

#### Future improvements

Upcoming releases will auto‑analyse dependencies and only block when truly necessary. Until then, explicit deferral will give you the best performance.

