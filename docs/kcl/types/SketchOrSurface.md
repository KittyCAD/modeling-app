---
title: "SketchOrSurface"
excerpt: "A sketch surface or a sketch."
layout: manual
---

A sketch surface or a sketch.




**This schema accepts any of the following:**

A sketch type.

[`SketchSurface`](/docs/kcl/types/SketchSurface)








----
A sketch is a collection of paths.

When you define a sketch to a variable like:

```kcl
mySketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
```

The `mySketch` variable will be an executed [`Sketch`](/docs/kcl/types/Sketch) object. Executed being past tense, because the engine has already executed the commands to create the sketch.

The previous sketch commands will never be executed again, in this case.

If you would like to encapsulate the commands to create the sketch any time you call it, you can use a function.

```kcl
fn createSketch() {
  return startSketchOn('XY')
    |> startProfileAt([-12, 12], %)
    |> line(end = [24, 0])
    |> line(end = [0, -24])
    |> line(end = [-24, 0])
    |> close()
}
```

Now, every time you call `createSketch()`, the commands will be executed and a new sketch will be created.

When you assign the result of `createSketch()` to a variable (`mySketch = createSketch()`), you are assigning the executed sketch to that variable. Meaning that the sketch `mySketch` will not be executed again.

You can still execute _new_ commands on the sketch like `extrude`, `revolve`, `loft`, etc. and the sketch will be updated.

[`Sketch`](/docs/kcl/types/Sketch)








----





