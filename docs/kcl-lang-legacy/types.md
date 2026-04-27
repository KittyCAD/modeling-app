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

The syntax for declaring a tag is `$myTag` you would use it in the following
way:

```kcl
startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)
  |> angledLine(
       angle = segAng(rectangleSegmentA001) - 90,
       length = 196.99,
       tag = $rectangleSegmentB001,
     )
  |> angledLine(
       angle = segAng(rectangleSegmentA001),
       length = -segLen(rectangleSegmentA001),
       tag = $rectangleSegmentC001,
     )
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
```

When a function requires declaring a new tag (using the `$` syntax), the argument has type [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl).

### Tag identifiers

A tag created using a tag declarator can be used by writing its name without the `$`, e.g., `myTag`.
Where necessary to disambiguate from tag declarations, we call these tag identifiers.

In the example above we use the tag identifier `rectangleSegmentA001` to get the angle of the segment
using `segAng(rectangleSegmentA001)`.

Tags can identify either an edge or face of a solid, or a line or other edge of a sketch. Functions
which take a tag identifier as an argument will use either [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) (for the edge of a
solid or sketch) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace).

If a line in a sketch is tagged and then the sketch is extruded, the tag is a `TaggedEdge` before
extrusion and a `TaggedFace` after extrusion.

#### `START` and `END`

[`START`](/docs/kcl-std/consts/std-START) and [`END`](/docs/kcl-std/consts/std-END) are special tags
for identifying the starting and ending faces of an extruded solid.


### Tag Scope

Tags are scoped globally if in the root context meaning in this example you can 
use the tag `rectangleSegmentA001` in any function or expression in the file.

However if the code was written like this:

```kcl
fn rect(origin) {
  return startSketchOn(XZ)
    |> startProfile(at = origin)
    |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)
    |> angledLine(
         angle = segAng(rectangleSegmentA001) - 90,
         length = 196.99,
         tag = $rectangleSegmentB001,
       )
    |> angledLine(
         angle = segAng(rectangleSegmentA001),
         length = -segLen(rectangleSegmentA001),
         tag = $rectangleSegmentC001,
       )
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
}

rect(origin = [0, 0])
rect(origin = [20, 0])
``` 

Those tags would only be available in the `rect` function and not globally.

However you likely want to use those tags somewhere outside the `rect` function.

Tags are accessible through the sketch group they are declared in.
For example the following code works.

```kcl
fn rect(origin) {
  return startSketchOn(XZ)
    |> startProfile(at = origin)
    |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)
    |> angledLine(
         angle = segAng(rectangleSegmentA001) - 90,
         length = 196.99,
         tag = $rectangleSegmentB001,
       )
    |> angledLine(
         angle = segAng(rectangleSegmentA001),
         length = -segLen(rectangleSegmentA001),
         tag = $rectangleSegmentC001,
       )
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
}

rect(origin = [0, 0])
myRect = rect(origin = [20, 0])

myRect
  |> extrude(length = 10)
  |> fillet(radius = 0.5, tags = [myRect.tags.rectangleSegmentA001])
```

See how we use the tag `rectangleSegmentA001` in the `fillet` function outside
the `rect` function. This is because the `rect` function is returning the
sketch group that contains the tags.

---

If you find any issues using any of the above expressions or syntax,
please file an issue with the `ast` label on the [modeling-app
repo](https://github.com/KittyCAD/modeling-app/issues/new).
