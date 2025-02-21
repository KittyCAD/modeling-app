---
title: "SketchData"
excerpt: "Data for start sketch on. You can start a sketch on a plane or an solid."
layout: manual
---

Data for start sketch on. You can start a sketch on a plane or an solid.




**This schema accepts any of the following:**

Orientation data that can be used to construct a plane, not a plane in itself.

[`PlaneData`](/docs/kcl/types/PlaneData)








----
A plane.

[`Plane`](/docs/kcl/types/Plane)








----
A solid is a collection of extrude surfaces.

When you define a solid to a variable like:

```kcl
myPart = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)
```

The `myPart` variable will be an executed [`Solid`](/docs/kcl/types/Solid) object. Executed being past tense, because the engine has already executed the commands to create the solid.

The previous solid commands will never be executed again, in this case.

If you would like to encapsulate the commands to create the solid any time you call it, you can use a function.

```kcl
fn createPart() {
  return startSketchOn('XY')
    |> startProfileAt([-12, 12], %)
    |> line(end = [24, 0])
    |> line(end = [0, -24])
    |> line(end = [-24, 0])
    |> close()
    |> extrude(length = 6)
}
```

Now, every time you call `createPart()`, the commands will be executed and a new solid will be created.

When you assign the result of `createPart()` to a variable (`myPart = createPart()`), you are assigning the executed solid to that variable. Meaning that the solid `myPart` will not be executed again.

You can still execute _new_ commands on the solid like `shell`, `fillet`, `chamfer`, etc. and the solid will be updated.

[`Solid`](/docs/kcl/types/Solid)








----





