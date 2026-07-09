---
title: "gdt::angularity"
subtitle: "Function in std::gdt"
excerpt: "GD&T angularity annotation specifying how much faces or edges may deviate from an orientation at a basic angle relative to datum references."
layout: manual
---

GD&T angularity annotation specifying how much faces or edges may deviate from an orientation at a basic angle relative to datum references.

```kcl
gdt::angularity(
  tolerance: number(Length),
  faces?: [TaggedFace; 1+],
  edges?: [Edge | any; 1+],
  datums?: [string; 1+],
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontSize?: number(Length),
): [GdtAnnotation; 1+]
```

This is part of model-based definition (MBD).

Angularity is an orientation tolerance. The specified angle is a basic
dimension in the drawing or model geometry. The `tolerance` is a length
controlling the size of the zone, not an angular plus-or-minus value.
Provide at least one of `faces` or `edges`. Supplying both is allowed, but
omitting both is an error.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The tolerance zone size for orientation at a basic angle. | Yes |
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 1+] | The faces to be annotated. At least one of `faces` or `edges` must be supplied. | No |
| `edges` | [[`Edge`](/docs/kcl-std/types/std-types-Edge) or [`any`](/docs/kcl-std/types/std-types-any); 1+] | The edges to be annotated. At least one of `faces` or `edges` must be supplied. Edge specifier objects (`{ sideFaces = [...], endFaces? = [...], index? = 0 }`) are experimental; do not use them in generated or user-facing KCL yet. | No |
| `datums` | [[`string`](/docs/kcl-std/types/std-types-string); 1+] | The datum references to display in the feature control frame. Supports up to primary, secondary, and tertiary datums. | No |
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

basicAngle = 30deg
thickness = 3.5mm
flangeLength = 24mm
bendStartX = 5mm
legLength = 30mm
legRun = legLength * cos(basicAngle)
legRise = legLength * sin(basicAngle)
normalRun = thickness * sin(basicAngle)
normalRise = thickness * cos(basicAngle)
annotationFont = 2mm

stampedProfile = sketch(on = XY) {
  datumFace = line(start = [var 0mm, var 0mm], end = [var 24mm, var 0mm])
  flangeEnd = line(start = [var 24mm, var 0mm], end = [var 24mm, var 3.5mm])
  innerFlange = line(start = [var 24mm, var 3.5mm], end = [var 5mm, var 3.5mm])
  controlledSurface = line(start = [var 5mm, var 3.5mm], end = [var 30.98mm, var 18.5mm])
  tabEnd = line(start = [var 30.98mm, var 18.5mm], end = [var 29.23mm, var 21.53mm])
  outerSurface = line(start = [var 29.23mm, var 21.53mm], end = [var 3.25mm, var 6.53mm])
  outsideBend = line(start = [var 3.25mm, var 6.53mm], end = [var 0mm, var 0mm])
  coincident([datumFace.end, flangeEnd.start])
  coincident([flangeEnd.end, innerFlange.start])
  coincident([
    innerFlange.end,
    controlledSurface.start
  ])
  coincident([controlledSurface.end, tabEnd.start])
  coincident([tabEnd.end, outerSurface.start])
  coincident([outerSurface.end, outsideBend.start])
  coincident([outsideBend.end, datumFace.start])
  coincident([datumFace.start, ORIGIN])
  horizontal(datumFace)
  horizontal(innerFlange)
  vertical(flangeEnd)
  distance([datumFace.start, datumFace.end]) == flangeLength
  distance([flangeEnd.start, flangeEnd.end]) == thickness
  distance([innerFlange.start, innerFlange.end]) == flangeLength - bendStartX
  distance([
  controlledSurface.start,
  controlledSurface.end
]) == legLength
  distance([tabEnd.start, tabEnd.end]) == thickness
  distance([outerSurface.start, outerSurface.end]) == legLength
  parallel([controlledSurface, outerSurface])
  perpendicular([controlledSurface, tabEnd])
  angle([datumFace, controlledSurface]) == basicAngle
}

stampedPart = extrude(region(point = [12mm, 2mm], sketch = stampedProfile), length = 0.8mm)

gdt::datum(
  face = stampedPart.sketch.tags.datumFace,
  name = "A",
  framePosition = [6mm, -4mm],
  framePlane = XY,
  fontSize = annotationFont,
)
gdt::angularity(
  faces = [
    stampedPart.sketch.tags.controlledSurface
  ],
  tolerance = 0.1mm,
  datums = ["A"],
  framePosition = [-12mm, 11mm],
  framePlane = XZ,
  fontSize = annotationFont,
)

```


![Rendered example of gdt::angularity 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-angularity0.png)

```kcl
@settings(kclVersion = 2.0)

basicAngle = 30deg
thickness = 3.5mm
flangeLength = 24mm
bendStartX = 5mm
legLength = 30mm
legRun = legLength * cos(basicAngle)
legRise = legLength * sin(basicAngle)
normalRun = thickness * sin(basicAngle)
normalRise = thickness * cos(basicAngle)
annotationFont = 2mm

stampedProfile = sketch(on = XY) {
  datumFace = line(start = [var 0mm, var 0mm], end = [var 24mm, var 0mm])
  flangeEnd = line(start = [var 24mm, var 0mm], end = [var 24mm, var 3.5mm])
  innerFlange = line(start = [var 24mm, var 3.5mm], end = [var 5mm, var 3.5mm])
  controlledSurface = line(start = [var 5mm, var 3.5mm], end = [var 30.98mm, var 18.5mm])
  tabEnd = line(start = [var 30.98mm, var 18.5mm], end = [var 29.23mm, var 21.53mm])
  outerSurface = line(start = [var 29.23mm, var 21.53mm], end = [var 3.25mm, var 6.53mm])
  outsideBend = line(start = [var 3.25mm, var 6.53mm], end = [var 0mm, var 0mm])
  coincident([datumFace.end, flangeEnd.start])
  coincident([flangeEnd.end, innerFlange.start])
  coincident([
    innerFlange.end,
    controlledSurface.start
  ])
  coincident([controlledSurface.end, tabEnd.start])
  coincident([tabEnd.end, outerSurface.start])
  coincident([outerSurface.end, outsideBend.start])
  coincident([outsideBend.end, datumFace.start])
  coincident([datumFace.start, ORIGIN])
  horizontal(datumFace)
  horizontal(innerFlange)
  vertical(flangeEnd)
  distance([datumFace.start, datumFace.end]) == flangeLength
  distance([flangeEnd.start, flangeEnd.end]) == thickness
  distance([innerFlange.start, innerFlange.end]) == flangeLength - bendStartX
  distance([
  controlledSurface.start,
  controlledSurface.end
]) == legLength
  distance([tabEnd.start, tabEnd.end]) == thickness
  distance([outerSurface.start, outerSurface.end]) == legLength
  parallel([controlledSurface, outerSurface])
  perpendicular([controlledSurface, tabEnd])
  angle([datumFace, controlledSurface]) == basicAngle
}

stampedRegion = region(point = [12mm, 2mm], sketch = stampedProfile)
hide(stampedProfile)
stampedPart = extrude(stampedRegion, length = 0.8mm)

gdt::datum(
  face = stampedPart.sketch.tags.datumFace,
  name = "A",
  framePosition = [6mm, -4mm],
  framePlane = XY,
  fontSize = annotationFont,
)
gdt::angularity(
  edges = [stampedRegion.tags.controlledSurface],
  tolerance = 0.1mm,
  datums = ["A"],
  framePosition = [-12mm, 11mm],
  framePlane = XZ,
  fontSize = annotationFont,
)

```


![Rendered example of gdt::angularity 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-angularity1.png)
