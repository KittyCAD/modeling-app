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

```
myBool = false
```

Currently you cannot redeclare a constant.

## Arrays

An array is defined with `[]` braces. What is inside the brackets can
be of any type. For example, the following is completely valid:

```
myArray = ["thing", 2, false]
```

If you want to get a value from an array you can use the index like so:
`myArray[0]`.


## Objects

An object is defined with `{}` braces. Here is an example object:

```
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

### `TagDeclarator`

The syntax for declaring a tag is `$myTag` you would use it in the following
way:

```norun
startSketchOn(XZ)
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
```

### `TagIdentifier`

As per the example above you can use the tag identifier to get a reference to the 
tagged object. The syntax for this is `myTag`.

In the example above we use the tag identifier to get the angle of the segment
`segAng(rectangleSegmentA001)`.

### `Start`

There is a special tag, `START` (with type `Start`, although under the cover, it's a string)
for identifying the face of a solid which was the start of an extrusion (i.e., the surface which
is extruded).

### `End`

There is a special tag, `END` (with type `End`, although under the cover, it's a string)
for identifying the face of a solid which was finishes an extrusion.

### Tag Scope

Tags are scoped globally if in the root context meaning in this example you can 
use the tag `rectangleSegmentA001` in any function or expression in the file.

However if the code was written like this:

```norun
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

```norun
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
