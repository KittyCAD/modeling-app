---
title: "Sketch on Face"
excerpt: "Sketching on the face of a solid using the KCL language for the Zoo Design Studio."
layout: manual
---

When you sketch on a plane and extrude, a new solid is created.

```kcl
cube = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 0])
  |> line(end = [0, 1])
  |> line(end = [-1, 0])
  |> line(end = [0, -1])
  |> close()
  |> extrude(length = 1)
```

However, when you sketch on the face of an existing solid, extruding extends the
existing solid.

```kcl
cube = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 0])
  |> line(end = [0, 1])
  |> line(end = [-1, 0])
  |> line(end = [0, -1])
  |> close()
  |> extrude(length = 1)

tower = startSketchOn(cube, face = END)
  |> circle(center = [0.5, 0.5], diameter = 0.2)
  |> extrude(length = 0.8)
```

The result is that there's only one solid. You can think about this as being
equivalent to making a new, separate solid and unioning the two in a single
operation.

On the other hand, if you don't want to change the initial solid and create a
new solid instead, there are a couple ways to do this.

The first way is instead of starting the sketch on the face of the solid, start
the sketch on the same plane. Since it's not directly on the first solid's face,
extrusions do not modify the solid. They create new solids instead.

```kcl
cube = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 0])
  |> line(end = [0, 1])
  |> line(end = [-1, 0])
  |> line(end = [0, -1])
  |> close()
  |> extrude(length = 1)

// This tower is a separate solid from the cube.
tower = startSketchOn(planeOf(cube, face = END))
  |> circle(center = [0.5, 0.5], diameter = 0.2)
  |> extrude(length = 0.8)
```

The second way to create a separate solid is by using the `method` parameter of
`extrude()`. You can start the sketch on the face, but when extruding, specify
that the method should create a new solid using `method = NEW`.

```kcl
cube = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 0])
  |> line(end = [0, 1])
  |> line(end = [-1, 0])
  |> line(end = [0, -1])
  |> close()
  |> extrude(length = 1)

// This tower is a separate solid from the cube.
tower = startSketchOn(cube, face = END)
  |> circle(center = [0.5, 0.5], diameter = 0.2)
  |> extrude(method = NEW, length = 0.8)
```

Once you have a separate solid, you can translate or rotate it separately or use
boolean operations like union, subtract, and intersect.

If you intend to create a single solid, you should prefer to sketch-on-face
since it's more succinct, efficient, and robust. But sometimes you need the
flexibility of creating a separate solid.
