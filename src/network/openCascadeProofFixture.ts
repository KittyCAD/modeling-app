export const OPEN_CASCADE_CIRCLE_EXTRUDE_KCL = `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 0.89mm, var 0.72mm], center = [var 0mm, var 0mm])
  coincident([circle1.center, ORIGIN])
}
hidden001 = hide(sketch001)
region001 = region(point = [-0.8880564mm, -0.7184276mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5)
`

export const OPEN_CASCADE_REVOLVE_KCL = `sketch001 = startSketchOn(XY)
  |> circle(center = [15, 0], radius = 5)
  |> revolve(angle = 360, axis = Y)
`

export const OPEN_CASCADE_SWEEP_KCL = `sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 10])

profile001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> sweep(path = sweepPath)
`

export const OPEN_CASCADE_LOFT_KCL = `squareSketch = startSketchOn(XY)
  |> startProfile(at = [-5, 5])
  |> line(end = [10, 0])
  |> line(end = [0, -10])
  |> line(end = [-10, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

triangleSketch = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 5])
  |> line(end = [-5, -10])
  |> line(end = [10, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

squareRegion = region(point = [0, 0], sketch = squareSketch)
triangleRegion = region(point = [0, 0], sketch = triangleSketch)
loft001 = loft([triangleRegion, squareRegion])
`

export const OPEN_CASCADE_SKETCH_V2_RECTANGLE_KCL = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  line2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  line3 = line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  line4 = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line1)
  coincident([line1.start, ORIGIN])
  distance([line1.start, line1.end]) == 10
  equalLength([line4, line1])
}
`

export const OPEN_CASCADE_SKETCH_V2_CIRCLE_KCL = `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([circle1.center, ORIGIN])
  radius(circle1) == 5
}
`

export const OPEN_CASCADE_PROOF_FIXTURES = [
  {
    name: 'openCascadeProofFixture',
    code: OPEN_CASCADE_CIRCLE_EXTRUDE_KCL,
  },
  {
    name: 'openCascadeRevolveProofFixture',
    code: OPEN_CASCADE_REVOLVE_KCL,
  },
  {
    name: 'openCascadeSweepProofFixture',
    code: OPEN_CASCADE_SWEEP_KCL,
  },
  {
    name: 'openCascadeLoftProofFixture',
    code: OPEN_CASCADE_LOFT_KCL,
  },
  {
    name: 'openCascadeSketchV2RectangleProofFixture',
    code: OPEN_CASCADE_SKETCH_V2_RECTANGLE_KCL,
  },
  {
    name: 'openCascadeSketchV2CircleProofFixture',
    code: OPEN_CASCADE_SKETCH_V2_CIRCLE_KCL,
  },
]
