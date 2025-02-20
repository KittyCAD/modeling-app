---
title: "SketchSet"
excerpt: "A sketch or a group of sketches."
layout: manual
---

A sketch or a group of sketches.





**This schema accepts exactly one of the following:**

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

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `sketch`|  | No |
| `id` |`string`| The id of the sketch (this will change when the engine's reference to it changes). | No |
| `paths` |`[` [`Path`](/docs/kcl/types/Path) `]`| The paths in the sketch. | No |
| `on` |[`SketchSurface`](/docs/kcl/types/SketchSurface)| What the sketch is on (can be a plane or a face). | No |
| `start` |[`BasePath`](/docs/kcl/types/BasePath)| The starting path. | No |
| `tags` |`object`| Tag identifiers that have been declared in this sketch. | No |
| `artifactId` |[`ArtifactId`](/docs/kcl/types/ArtifactId)| The original id of the sketch. This stays the same even if the sketch is is sketched on face etc. | No |
| `originalId` |`string`|  | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A sketch or a group of sketches. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`| Metadata. | No |


----

**Type:** `[object, array]`

`[` [`Sketch`](/docs/kcl/types/Sketch) `]`



## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `sketches`|  | No |


----




