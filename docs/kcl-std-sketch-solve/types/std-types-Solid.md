---
title: "Solid"
subtitle: "Type in std::types"
excerpt: "A solid is a collection of extruded surfaces."
layout: manual
---

A solid is a collection of extruded surfaces.

When you define a solid to a variable like:

```js
myPart = startSketchOn(XY)
    |> startProfile(at = [-12, 12])
    |> line(end = [24, 0])
    |> line(end = [0, -24])
    |> line(end = [-24, 0])
    |> close()
    |> extrude(length = 6)
```

The `myPart` variable will be an executed [`Solid`](/docs/kcl-std/types/std-types-Solid) object. Executed being past
tense, because the engine has already executed the commands to create the solid.

The previous solid commands will never be executed again, in this case.

If you would like to encapsulate the commands to create the solid any time you call it,
you can use a function.

```js
fn createPart() {
   return startSketchOn(XY)
        |> startProfile(at = [-12, 12])
        |> line(end = [24, 0])
        |> line(end = [0, -24])
        |> line(end = [-24, 0])
        |> close()
        |> extrude(length = 6)
}
```

Now, every time you call `createPart()`, the commands will be
executed and a new solid will be created.

When you assign the result of `createPart()` to a variable (`myPart = createPart()`), you are assigning
the executed solid to that variable. Meaning that the solid `myPart` will not be executed
again.

You can still execute _new_ commands on the solid like `shell`, `fillet`, `chamfer`, etc.
and the solid will be updated.



