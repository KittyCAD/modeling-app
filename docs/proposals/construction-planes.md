# Construction planes: draft implementation

Related: [#11204](https://github.com/KittyCAD/modeling-app/issues/11204).

This draft implements `plane(...): Plane` in this repository's KCL stdlib and adds a Construction plane command in the modeling app. It uses the existing MakePlane command and plane lifecycle. No engine repository changes are needed.

## Try it in the preview

1. Open a project and find **Construction plane** in the command palette or planes toolbar dropdown.
2. Choose Point and normal, Axes and origin, Three points, or Equation.
3. Enter the fields and continue to review. The defaults for all methods create the same plane 20 units above XY. Invalid frames are rejected during review before source is committed.
4. Create the plane. Click Start sketch and select its feature-tree entry or the plane in the viewport.
5. Double-click its feature-tree entry to edit the inputs or change methods. Cancel leaves source unchanged; existing app history handles undo/redo.

Point/vector inputs currently use numeric expressions and arrays. Associative viewport picking of model points and lines, object-form coordinates, and parallel/angled/midplane helpers remain follow-up work. Existing Offset plane and planar-face workflows remain available.

## KCL forms

```kcl
@settings(kclVersion = 2.0)

axesPlane = plane(origin = [0mm, 0mm, 20mm], xAxis = [1, 0, 0], yAxis = [0, 1, 0])
normalPlane = plane(origin = [0mm, 0mm, 20mm], normal = [0, 0, 1], xAxis = [1, 0, 0])
pointsPlane = plane(points = [[0mm, 0mm, 20mm], [10mm, 0mm, 20mm], [0mm, 10mm, 20mm]])
equationPlane = plane(a = 0, b = 0, c = 1, d = -20mm, xAxis = [1, 0, 0])
```

Choose exactly one argument group. Directions and coefficients are dimensionless; points and `d` are lengths. Axes must be perpendicular and are normalized. Normal/equation forms project `xAxis` into the plane and reject a parallel hint. Three ordered points define origin, +X direction, and normal using the right-hand rule. Equation form uses `a*x+b*y+c*z+d=0`, with its sketch origin at the closest point on that plane to the world origin.

Duplicate/collinear points, zero or nonfinite directions, skew axes, mixed definition groups, and incompatible units produce diagnostics. Old custom-plane object coercion, default planes, `offsetPlane`, and `planeOf` are unchanged.

## A visible tilted sketch

Paste this into an empty file to exercise a plane that cannot be made by merely offsetting a default plane:

```kcl
@settings(kclVersion = 2.0)
support = plane(origin = [0mm, 0mm, 20mm], normal = [0, -1, 1], xAxis = [1, 0, 0])
outline = sketch(on = support) {
  bottom = line(start = [0mm, 0mm], end = [20mm, 0mm])
  right = line(start = [20mm, 0mm], end = [20mm, 10mm])
  top = line(start = [20mm, 10mm], end = [0mm, 10mm])
  left = line(start = [0mm, 10mm], end = [0mm, 0mm])
}
face = region(point = [5mm, 5mm], sketch = outline)
body = extrude(face, length = 5mm)
```

The draft includes pure frame tests, engineless KCL/AST integration tests, nested numeric-array input tests, and web Playwright coverage for creating and sketching on each method. Preview deployment and validation results are recorded in the PR.
