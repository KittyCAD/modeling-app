---
title: "gdt::profile"
subtitle: "Function in std::gdt"
excerpt: "GD&T profile annotation specifying how much edges or faces may deviate from their ideal shape."
layout: manual
---

GD&T profile annotation specifying how much edges or faces may deviate from their ideal shape.

```kcl
gdt::profile(
  tolerance: number(Length),
  edges?: [Edge | any; 1+],
  faces?: [TaggedFace; 1+],
  datums?: [string; 1+],
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontSize?: number(Length),
): [GdtAnnotation; 1+]
```

This is part of model-based definition (MBD).

`gdt::profile` is kept for backwards compatibility with existing KCL programs.
For new code, prefer `gdt::profileLine` when annotating edges and
`gdt::profileSurface` when annotating faces.

Provide exactly one of `edges` or `faces`. Passing `edges` delegates to
`profileLine`; passing `faces` delegates to `profileSurface`. Passing both,
or neither, is a KCL error.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount of deviation from an ideal profile that is acceptable. | Yes |
| `edges` | [[`Edge`](/docs/kcl-std/types/std-types-Edge) or [`any`](/docs/kcl-std/types/std-types-any); 1+] | The edges to be annotated with profile of a line. Provide either `edges` or `faces`, but not both. Edge specifier objects (`{ sideFaces = [...], endFaces? = [...], index? = 0 }`) are experimental; do not use them in generated or user-facing KCL yet. | No |
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 1+] | The faces to be annotated with profile of a surface. Provide either `edges` or `faces`, but not both. | No |
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

gdt::profile(
  edges = [profileEdge],
  tolerance = 0.1mm,
  datums = ["A"],
  framePosition = [10mm, 20mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::profile 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-profile0.png)

```kcl
cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinder = extrude(region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch), length = 10mm, tagEnd = $top)
gdt::profile(
  faces = [top],
  tolerance = 0.05mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::profile 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-profile1.png)


