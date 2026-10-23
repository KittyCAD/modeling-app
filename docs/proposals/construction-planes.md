# Construction planes: draft implementation

Related: [#11204](https://github.com/KittyCAD/modeling-app/issues/11204).

This draft implements `plane(...): Plane` in this repository's KCL stdlib and adds a Construction plane command in the modeling app. It uses the existing MakePlane command and plane lifecycle. No engine repository changes are needed.

## Try it in the preview

1. Open a project and click **Plane** in the toolbar. Existing selected references are used automatically, or select them after opening the tool. Hold Shift to add references.
2. The selection determines the definition below. Continue to review; only a single plane or face asks for an offset distance, initially zero.
3. For manual inputs, change **Definition** to Point and normal, Axes and origin, Three points, or Equation. Invalid frames are rejected before source is committed.
4. Create the plane. Click Start sketch and select its feature-tree entry or the plane in the viewport.
5. Double-click its feature-tree entry to edit the inputs or change methods. Cancel leaves source unchanged; existing app history handles undo/redo.

| References | Definition |
| --- | --- |
| One plane or planar face | Offset, including zero distance |
| Two parallel planes or planar faces | Midplane |
| A plane or planar face and one corner point | Parallel through point |
| Two distinct corner points | Perpendicular bisector |
| Three non-collinear corner points | Through three points |

The tool enables face, plane, and corner selection together. The public Points filter remains available for preselecting corners. Manual Three points also offers entering coordinates. Reference coordinates are stored as explicit millimeter literals, preserving their world positions in projects using other units. Editing opens the saved coordinates; choose From selected geometry to replace the references. Offset distance remains an editable KCL expression.

These are coordinate snapshots, so subsequent edits to the source part do not update the plane. Picking uses existing engine topology and curve queries and rejects ambiguous/unresolvable corners. Midplanes require parallel faces and reject curved or non-parallel references. Reversing the first plane's normal changes orientation without moving the midplane. Arbitrary points within faces, associative references, edge-based and angled planes remain follow-up work. Existing Offset plane commands and existing KCL retain their behavior.

## KCL forms

```kcl
@settings(kclVersion = 3.0)

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
@settings(kclVersion = 3.0)
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
