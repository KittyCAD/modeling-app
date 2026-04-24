---
title: "Sketch on Face"
excerpt: "Sketching on the face of a solid using the KCL language for the Zoo Design Studio."
layout: manual
---

When you sketch on a plane and extrude, a new solid is created.

```kcl
squareSketch = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 1mm, var 0mm])
  line2 = line(start = [var 1mm, var 0mm], end = [var 1mm, var 1mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 1mm, var 1mm], end = [var 0mm, var 1mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 0mm, var 1mm], end = [var 0mm, var 0mm])
  coincident([line3.end, line4.start])
}
region001 = region(segments = [squareSketch.line1, squareSketch.line2])
cube = extrude(region001, length = 1)
```

However, when you sketch on the face of an existing solid, extruding extends the
existing solid.

```kcl
squareSketch = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 1mm, var 0mm])
  line2 = line(start = [var 1mm, var 0mm], end = [var 1mm, var 1mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 1mm, var 1mm], end = [var 0mm, var 1mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 0mm, var 1mm], end = [var 0mm, var 0mm])
  coincident([line3.end, line4.start])
}
region001 = region(segments = [squareSketch.line1, squareSketch.line2])
cube = extrude(region001, length = 1)

towerSketch = sketch(on = startSketchOn(cube, face = END)) {
  circle1 = circle(start = [var 0.6mm, var 0.5mm], center = [var 0.5mm, var 0.5mm])
}
region002 = region(segments = [towerSketch.circle1])
tower = extrude(region002, length = 0.8)
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
squareSketch = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 1mm, var 0mm])
  line2 = line(start = [var 1mm, var 0mm], end = [var 1mm, var 1mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 1mm, var 1mm], end = [var 0mm, var 1mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 0mm, var 1mm], end = [var 0mm, var 0mm])
  coincident([line3.end, line4.start])
}
region001 = region(segments = [squareSketch.line1, squareSketch.line2])
cube = extrude(region001, length = 1)

// This tower is a separate solid from the cube.
towerSketch = sketch(on = planeOf(cube, face = END)) {
  circle1 = circle(start = [var 0.6mm, var 0.5mm], center = [var 0.5mm, var 0.5mm])
}
region002 = region(segments = [towerSketch.circle1])
tower = extrude(region002, length = 0.8)
```

The second way to create a separate solid is by using the `method` parameter of
`extrude()`. You can start the sketch on the face, but when extruding, specify
that the method should create a new solid using `method = NEW`.

```kcl
squareSketch = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 1mm, var 0mm])
  line2 = line(start = [var 1mm, var 0mm], end = [var 1mm, var 1mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 1mm, var 1mm], end = [var 0mm, var 1mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 0mm, var 1mm], end = [var 0mm, var 0mm])
  coincident([line3.end, line4.start])
}
region001 = region(segments = [squareSketch.line1, squareSketch.line2])
cube = extrude(region001, length = 1)

// This tower is a separate solid from the cube.
towerSketch = sketch(on = startSketchOn(cube, face = END)) {
  circle1 = circle(start = [var 0.6mm, var 0.5mm], center = [var 0.5mm, var 0.5mm])
}
region002 = region(segments = [towerSketch.circle1])
tower = extrude(region002, method = NEW, length = 0.8)
```

Once you have a separate solid, you can translate or rotate it separately or use
boolean operations like union, subtract, and intersect.

If you intend to create a single solid, you should prefer to sketch-on-face
since it's more succinct, efficient, and robust. But sometimes you need the
flexibility of creating a separate solid.
