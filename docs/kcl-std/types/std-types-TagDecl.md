---
title: "TagDecl"
subtitle: "Type in std::types"
excerpt: "Tags are used to give a name (tag) to a specific path."
layout: manual
---

Tags are used to give a name (tag) to a specific path.

### Tag Declaration

The syntax for declaring a tag is `$myTag`. You would use it in the following
way:

```js
startSketchOn(XZ)
  |> startProfile(at = origin)
  |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)
  |> angledLine(
       angle = segAng(rectangleSegmentA001) - 90deg,
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

### Tag Scope

Tags are scoped globally if in the root context meaning in this example you can
use the tag `rectangleSegmentA001` in any function or expression in the file.

However if the code was written like this:

```js
fn rect(origin) {
  return startSketchOn(XZ)
    |> startProfile(at = origin)
    |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)
    |> angledLine(
         angle = segAng(rectangleSegmentA001) - 90,
         length = 196.99,
         tag = $rectangleSegmentB001
       )
    |> angledLine(
         angle = segAng(rectangleSegmentA001),
         length = -segLen(rectangleSegmentA001),
         tag = $rectangleSegmentC001
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

```js
fn rect(origin) {
  return startSketchOn(XZ)
    |> startProfile(at = origin)
    |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)
    |> angledLine(
         angle = segAng(rectangleSegmentA001) - 90deg,
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



