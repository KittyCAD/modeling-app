---
title: "gdt::symmetry"
subtitle: "Function in std::gdt"
excerpt: "GD&T symmetry annotation specifying how closely a feature's median plane must align with datum references."
layout: manual
---

GD&T symmetry annotation specifying how closely a feature's median plane must align with datum references.

```kcl
gdt::symmetry(
  tolerance: number(Length),
  datums: [string; 1+],
  faces?: [TaggedFace; 1+],
  edges?: [Edge; 1+],
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontSize?: number(Length),
): [GdtAnnotation; 1+]
```

This is part of model-based definition (MBD).

Symmetry is a location tolerance for features of size. It controls the
derived median points of opposing feature surfaces relative to a datum
center plane. The tolerance zone is bounded by two parallel planes equally
disposed about the datum plane, with a total width equal to `tolerance`.
Datum references are required.

Symmetry is the non-circular counterpart to concentricity. It is typically
used where mass balance or form distribution about a datum plane matters,
but it is difficult to inspect and is often replaced by position or profile
controls where appropriate.

In American Society of Mechanical Engineers (ASME) Y14.5, symmetry is
applied regardless of feature size (RFS) and does not use maximum material
condition (MMC) or least material condition (LMC) modifiers.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The total width of the tolerance zone between two parallel planes. | Yes |
| `datums` | [[`string`](/docs/kcl-std/types/std-types-string); 1+] | The datum references to display in the feature control frame. Supports up to primary, secondary, and tertiary datums. | Yes |
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 1+] | The faces to be annotated. | No |
| `edges` | [[`Edge`](/docs/kcl-std/types/std-types-Edge); 1+] | The edges to be annotated. | No |
| `precision` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of decimal places to display. The default is `3`. Must be greater than or equal to `0` and less than or equal to `9`. | No |
| `framePosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The position of the feature control frame relative to the leader arrow. The default is `[100mm, 100mm]`. | No |
| `framePlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane in which to display the feature control frame. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The frame may be displayed in a plane parallel to the given plane. | No |
| `leaderScale` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Visual scale of the leader dot. The default is `1.0`, which maps to the calibrated normal dot size. The value is normalized against `fontSize` so the dot stays consistent as text size changes. Must be greater than `0`. | No |
| `fontSize` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The model-space height to use for annotation text. The default is `10mm`. Explicit units are supported; bare numbers use the file's default length unit. This changes the scene size, not the internal raster texture quality. | No |

### Returns

[[`GdtAnnotation`](/docs/kcl-std/types/std-types-GdtAnnotation); 1+]


### Examples

```kcl
@settings(kclVersion = 2.0)

latchProfile = sketch(on = XZ) {
  bottom = line(start = [var -20mm, var -10mm], end = [var 20mm, var -10mm])
  datumWidthFace = line(start = [var 20mm, var -10mm], end = [var 20mm, var 10mm])
  topRight = line(start = [var 20mm, var 10mm], end = [var 5mm, var 10mm])
  rightGrooveWall = line(start = [var 5mm, var 10mm], end = [var 5mm, var 3mm])
  grooveFloor = line(start = [var 5mm, var 3mm], end = [var -5mm, var 3mm])
  leftGrooveWall = line(start = [var -5mm, var 3mm], end = [var -5mm, var 10mm])
  topLeft = line(start = [var -5mm, var 10mm], end = [var -20mm, var 10mm])
  leftSide = line(start = [var -20mm, var 10mm], end = [var -20mm, var -10mm])
  coincident([bottom.end, datumWidthFace.start])
  coincident([datumWidthFace.end, topRight.start])
  coincident([topRight.end, rightGrooveWall.start])
  coincident([rightGrooveWall.end, grooveFloor.start])
  coincident([grooveFloor.end, leftGrooveWall.start])
  coincident([leftGrooveWall.end, topLeft.start])
  coincident([topLeft.end, leftSide.start])
  coincident([leftSide.end, bottom.start])
  horizontal(bottom)
  vertical(datumWidthFace)
  horizontal(topRight)
  vertical(rightGrooveWall)
  horizontal(grooveFloor)
  vertical(leftGrooveWall)
  horizontal(topLeft)
  vertical(leftSide)
}

latchBlockRegion = region(point = [0mm, 0mm], sketch = latchProfile)
latchBlock = extrude(latchBlockRegion, length = 12mm)

gdt::datum(
  face = latchBlock.sketch.tags.bottom,
  name = "A",
  framePosition = [0mm, -16mm],
  framePlane = XZ,
)
gdt::symmetry(
  faces = [latchBlock.sketch.tags.grooveFloor],
  tolerance = 0.2mm,
  datums = ["A"],
  framePosition = [-24mm, 14mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::symmetry 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-symmetry0.png)

```kcl
@settings(kclVersion = 2.0)

latchProfile = sketch(on = XZ) {
  bottom = line(start = [var -20mm, var -10mm], end = [var 20mm, var -10mm])
  datumWidthFace = line(start = [var 20mm, var -10mm], end = [var 20mm, var 10mm])
  topRight = line(start = [var 20mm, var 10mm], end = [var 5mm, var 10mm])
  rightGrooveWall = line(start = [var 5mm, var 10mm], end = [var 5mm, var 3mm])
  grooveFloor = line(start = [var 5mm, var 3mm], end = [var -5mm, var 3mm])
  leftGrooveWall = line(start = [var -5mm, var 3mm], end = [var -5mm, var 10mm])
  topLeft = line(start = [var -5mm, var 10mm], end = [var -20mm, var 10mm])
  leftSide = line(start = [var -20mm, var 10mm], end = [var -20mm, var -10mm])
  coincident([bottom.end, datumWidthFace.start])
  coincident([datumWidthFace.end, topRight.start])
  coincident([topRight.end, rightGrooveWall.start])
  coincident([rightGrooveWall.end, grooveFloor.start])
  coincident([grooveFloor.end, leftGrooveWall.start])
  coincident([leftGrooveWall.end, topLeft.start])
  coincident([topLeft.end, leftSide.start])
  coincident([leftSide.end, bottom.start])
  horizontal(bottom)
  vertical(datumWidthFace)
  horizontal(topRight)
  vertical(rightGrooveWall)
  horizontal(grooveFloor)
  vertical(leftGrooveWall)
  horizontal(topLeft)
  vertical(leftSide)
}

latchBlockRegion = region(point = [0mm, 0mm], sketch = latchProfile)
latchBlock = extrude(latchBlockRegion, length = 12mm, tagEnd = $frontFace)
grooveFloorFrontEdge = getCommonEdge(faces = [
  latchBlock.sketch.tags.grooveFloor,
  frontFace
])

gdt::datum(
  face = latchBlock.sketch.tags.bottom,
  name = "A",
  framePosition = [0mm, -16mm],
  framePlane = XZ,
)
gdt::symmetry(
  edges = [grooveFloorFrontEdge],
  tolerance = 0.2mm,
  datums = ["A"],
  framePosition = [-24mm, 14mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::symmetry 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-symmetry1.png)


