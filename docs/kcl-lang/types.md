---
title: "Values and types"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

`KCL` defines the following types and keywords the language.

All these types can be nested in various forms where nesting applies. Like
arrays can hold objects and vice versa.

## Constant declaration

Constants are defined with a name and a value, like so:

```kcl
myBool = false
```

Currently you cannot redeclare a constant.


## Objects

An object is defined with `{}` braces. Here is an example object:

```kcl
myObj = { a = 0, b = "thing" }
```

To get the property of an object, you can call `myObj.a`, which in the above
example returns 0.

## `ImportedGeometry`

Using `import` you can import geometry defined using other CAD software. In KCL,
these objects have type `ImportedGeometry` and can mostly be treated like any
other solid (they can be rotated, scaled, etc.), although there is no access to
their internal components. See the [modules and imports docs](modules) for more
detail on importing geometry.


## Tags

Tags are used to give a name (tag) to a specific path.

### Tag declarations - `TagDecl`


The syntax for declaring a tag is `$myTag`. Tags are used for bodies (such as extrude cap faces). For sketches, reference segment names directly.

**Example: Referencing sketch segments and tagging cap faces**

```kcl
sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -2.17mm, var -0.91mm], end = [var 3.01mm, var -1.57mm])
  line2 = line(start = [var 3.01mm, var -1.57mm], end = [var 3.13mm, var 3.12mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 3.13mm, var 3.12mm], end = [var -2.26mm, var 2.4mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -2.26mm, var 2.4mm], end = [var -2.17mm, var -0.91mm])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
region001 = region(point = [0.4203mm, -1.2375mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5, tagEnd = $capEnd001)
fillet001 = fillet(extrude001, tags = getCommonEdge(faces = [region001.tags.line4, capEnd001]), radius = 1)
```


In this example, you reference sketch segments by their names (e.g., `line4`). Tags (using `$`) are only needed for cap faces or other body features.

When a function requires declaring a new tag (using the `$` syntax), the argument has type [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl).

### Tag identifiers

A tag created using a tag declarator can be used by writing its name without the `$`, e.g., `myTag`.
Where necessary to disambiguate from tag declarations, we call these tag identifiers.

In the example above we use the tag identifier `rectangleSegmentA001` to get the angle of the segment
using `segAng(rectangleSegmentA001)`.


Tags can identify an edge or face of a solid. Functions that take a tag identifier as an argument will use either [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) (for the edge of a solid) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace).

For sketches, always use the segment name (e.g., `line1`, `line2`).

#### `START` and `END`

[`START`](/docs/kcl-std/consts/std-START) and [`END`](/docs/kcl-std/consts/std-END) are special tags
for identifying the starting and ending faces of an extruded solid.


### Tag Scope

Tags are scoped globally if declared in the root context. For bodies, you can use the tag anywhere in the file. For sketches, always use the segment name directly.

---

If you find any issues using any of the above expressions or syntax,
please file an issue with the `ast` label on the [modeling-app
repo](https://github.com/KittyCAD/modeling-app/issues/new).
