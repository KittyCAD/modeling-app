---
title: "gdt::concentricity"
subtitle: "Function in std::gdt"
excerpt: "GD&T concentricity annotation specifying how closely a feature's median axis must align with datum references."
layout: manual
---

GD&T concentricity annotation specifying how closely a feature's median axis must align with datum references.

```kcl
gdt::concentricity(
  tolerance: number(Length),
  datums: [string; 1+],
  faces?: [TaggedFace; 1+],
  edges?: [Edge | any; 1+],
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontSize?: number(Length),
): [GdtAnnotation; 1+]
```

This is part of MBD.

Concentricity is a location tolerance for features of size. It controls the
derived median points of the annotated feature relative to a datum axis. The
tolerance zone is cylindrical, with a diameter equal to `tolerance`. Datum
references are required.

In American Society of Mechanical Engineers (ASME) Y14.5, concentricity is
applied regardless of feature size (RFS) and does not use maximum material
condition (MMC) or least material condition (LMC) modifiers. ASME Y14.5-2018
removed concentricity in favor of other controls such as position or runout
where appropriate. ISO standards use the name coaxiality for this concept.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The diameter of the cylindrical tolerance zone. | Yes |
| `datums` | [[`string`](/docs/kcl-std/types/std-types-string); 1+] | The datum references to display in the feature control frame. Supports up to primary, secondary, and tertiary datums. | Yes |
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 1+] | The faces to be annotated. | No |
| `edges` | [[`Edge`](/docs/kcl-std/types/std-types-Edge) or [`any`](/docs/kcl-std/types/std-types-any); 1+] | The edges to be annotated. Edge specifier objects (`{ sideFaces = [...], endFaces? = [...], index? = 0 }`) are experimental; do not use them in generated or user-facing KCL yet. | No |
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

datumSketch = sketch(on = XY) {
  diameter = line(start = [var -6mm, var 0mm], end = [var 6mm, var 0mm])
  perimeter = arc(start = [var 6mm, var 0mm], end = [var -6mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([diameter.end, perimeter.start])
  coincident([diameter.start, perimeter.end])
}

datumCylinder = extrude(region(point = [0mm, 1mm], sketch = datumSketch), length = 10mm)

controlledSketch = sketch(on = XY) {
  diameter = line(start = [var -3mm, var 0mm], end = [var 3mm, var 0mm])
  perimeter = arc(start = [var -3mm, var 0mm], end = [var 3mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([diameter.start, perimeter.start])
  coincident([diameter.end, perimeter.end])
}

controlledCylinder = extrude(region(point = [0mm, -1mm], sketch = controlledSketch), length = 10mm)

gdt::datum(
  face = datumCylinder.sketch.tags.perimeter,
  name = "A",
  framePosition = [-14mm, 8mm],
  framePlane = XZ,
)
gdt::concentricity(
  faces = [
    controlledCylinder.sketch.tags.perimeter
  ],
  tolerance = 0.05mm,
  datums = ["A"],
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::concentricity 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-concentricity0.png)

```kcl
@settings(kclVersion = 2.0)

datumSketch = sketch(on = XY) {
  perimeter = circle(start = [var 6mm, var 0mm], center = [var 0mm, var 0mm])
}

datumCylinder = extrude(region(point = datumSketch.perimeter.center, sketch = datumSketch), length = 10mm)

controlledSketch = sketch(on = XY) {
  perimeter = circle(start = [var 3mm, var 0mm], center = [var 0mm, var 0mm])
}

controlledCylinder = extrude(region(point = controlledSketch.perimeter.center, sketch = controlledSketch), length = 10mm, tagEnd = $top)
topEdge = {
  sideFaces = [
    controlledCylinder.sketch.tags.perimeter,
    top
  ]
}

gdt::datum(
  face = datumCylinder.sketch.tags.perimeter,
  name = "A",
  framePosition = [-14mm, 8mm],
  framePlane = XZ,
)
gdt::concentricity(
  edges = [topEdge],
  tolerance = 0.05mm,
  datums = ["A"],
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::concentricity 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-concentricity1.png)


