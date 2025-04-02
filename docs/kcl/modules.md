---
title: "KCL Modules"
excerpt: "Documentation of modules for the KCL language for the Zoo Modeling App."
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
using the native Modeling App, not in the browser.

### Supported values

File formats: `fbx`, `gltf`/`glb`, `obj`+, `ply`+, `sldprt`, `step`/`stp`, `stl`+. (Those marked with a
'+' support customising the length unit and coordinate system).

Length units: `mm` (the default), `cm`, `m`, `inch`, `ft`, `yd`.

Coordinate systems:

- `zoo` (the default), forward: -Y, up: +Z, handedness: right
- `opengl`, forward: +Z, up: +Y, handedness: right
- `vulkan`, forward: +Z, up: -Y, handedness: left
