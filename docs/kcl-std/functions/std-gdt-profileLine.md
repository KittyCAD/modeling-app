---
title: "gdt::profileLine"
subtitle: "Function in std::gdt"
excerpt: "GD&T profile-of-a-line annotation specifying how much edges may deviate from their ideal shape."
layout: manual
---

GD&T profile-of-a-line annotation specifying how much edges may deviate from their ideal shape.

```kcl
gdt::profileLine(
  edges: [Edge | any; 1+],
  tolerance: number(Length),
  datums?: [string; 1+],
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontSize?: number(Length),
): [GdtAnnotation; 1+]
```

This is part of model-based definition (MBD).

Profile of a line is a two-dimensional tolerance zone for a cross-section or edge-like profile.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `edges` | [[`Edge`](/docs/kcl-std/types/std-types-Edge) or [`any`](/docs/kcl-std/types/std-types-any); 1+] | The edges to be annotated. Edge specifier objects (`{ sideFaces = [...], endFaces? = [...], index? = 0 }`) are experimental; do not use them in generated or user-facing KCL yet. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount of deviation from an ideal profile that is acceptable. | Yes |
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
startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0], tag = $side1)
  |> line(end = [0, 10], tag = $side2)
  |> line(end = [-10, 0])
  |> line(end = [0, -10])
  |> close()
  |> extrude(length = 5, tagEnd = $top)

profileEdge = getCommonEdge(faces = [side1, top])

gdt::profileLine(
  edges = [profileEdge],
  tolerance = 0.1mm,
  datums = ["A"],
  framePosition = [10mm, 20mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::profileLine 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-profileLine0.png)

```kcl
blockProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 6mm])
  edge3 = line(start = [var 10mm, var 6mm], end = [var 0mm, var 6mm])
  edge4 = line(start = [var 0mm, var 6mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

block = extrude(region(point = [5mm, 3mm], sketch = blockProfile), length = 4mm, tagEnd = $top)
profileEdge = getCommonEdge(faces = [block.sketch.tags.edge1, top])
gdt::profileLine(
  edges = [profileEdge],
  tolerance = 0.05mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::profileLine 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-profileLine1.png)
