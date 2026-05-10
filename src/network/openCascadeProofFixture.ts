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
]
