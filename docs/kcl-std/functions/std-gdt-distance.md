---
title: "gdt::distance"
subtitle: "Function in std::gdt"
excerpt: "GD&T distance annotation for displaying measured edge lengths or distances between two entities."
layout: manual
---

GD&T distance annotation for displaying measured edge lengths or distances between two entities.

```kcl
gdt::distance(
  tolerance?: number(Length),
  from?: Face | TaggedFace | Edge | any,
  to?: Face | TaggedFace | Edge | any,
  edges?: [Edge | any; 1+],
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontSize?: number(Length),
): [GdtAnnotation; 1+]
```

This is part of model-based definition (MBD).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The acceptable distance tolerance. If not given, or 0, tolerance will not be shown. | No |
| `from` | [`Face`](/docs/kcl-std/types/std-types-Face) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`any`](/docs/kcl-std/types/std-types-any) | The face or edge to measure from. Must be used with `to`. The default position is the entity center. Edge specifier objects (`{ sideFaces = [...], endFaces? = [...], index? = 0 }`) are experimental; do not use them in generated or user-facing KCL yet. | No |
| `to` | [`Face`](/docs/kcl-std/types/std-types-Face) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`any`](/docs/kcl-std/types/std-types-any) | The face or edge to measure to. Must be used with `from`. The default position is the entity center. Edge specifier objects (`{ sideFaces = [...], endFaces? = [...], index? = 0 }`) are experimental; do not use them in generated or user-facing KCL yet. | No |
| `edges` | [[`Edge`](/docs/kcl-std/types/std-types-Edge) or [`any`](/docs/kcl-std/types/std-types-any); 1+] | The edges whose lengths are annotated. Cannot be combined with `from` or `to`. Edge specifier objects (`{ sideFaces = [...], endFaces? = [...], index? = 0 }`) are experimental; do not use them in generated or user-facing KCL yet. | No |
| `precision` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of decimal places to display. The default is `3`. Must be greater than or equal to `0` and less than or equal to `9`. | No |
| `framePosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The position of the distance label relative to the measured geometry. The default is `[100mm, 100mm]`. | No |
| `framePlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane in which to display the distance. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The distance may be displayed in a plane parallel to the given plane. | No |
| `leaderScale` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Scale of the distance arrows. The default is `1.0`. Must be greater than `0`. | No |
| `fontSize` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The model-space height to use for annotation text. The default is `10mm`. Explicit units are supported; bare numbers use the file's default length unit. This changes the scene size, not the internal raster texture quality. | No |

### Returns

[[`GdtAnnotation`](/docs/kcl-std/types/std-types-GdtAnnotation); 1+]


### Examples

```kcl
@settings(kclVersion = 2.0)

startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0], tag = $side1)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> line(end = [0, -10])
  |> close()
  |> extrude(length = 5, tagEnd = $top)

lengthEdge = getCommonEdge(faces = [side1, top])
gdt::distance(
  edges = [lengthEdge],
  tolerance = 0.05mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::distance 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-distance0.png)

```kcl
@settings(kclVersion = 2.0)

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

block = extrude(region(segments = [blockProfile.edge1, blockProfile.edge2]), length = 4mm, tagEnd = $top)
lengthEdge = getCommonEdge(faces = [block.sketch.tags.edge1, top])
gdt::distance(
  edges = [lengthEdge],
  tolerance = 0.05mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::distance 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-distance1.png)

```kcl
@settings(kclVersion = 2.0)

// Example of a distance annotation with no tolerance.

sketch001 = sketch(on = XY) {
  line1 = line(start = [var -6.19mm, var 4.16mm], end = [var 7.91mm, var 4.16mm])
  line2 = line(start = [var 7.91mm, var 4.16mm], end = [var 7.91mm, var -3.35mm])
  line3 = line(start = [var 7.91mm, var -3.35mm], end = [var -6.19mm, var -3.35mm])
  line4 = line(start = [var -6.19mm, var -3.35mm], end = [var -6.19mm, var 4.16mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
hidden001 = hide(sketch001)
region001 = region(segments = [sketch001.line1, sketch001.line2], direction = CW)
extrude001 = extrude(region001, length = 1, tagEnd = $capEnd001)
gdt::distance(
  edges = [
    getCommonEdge(faces = [
      region001.tags.line1,
      extrude001.faces.capEnd001
    ])
  ],
  framePosition = [5, 5],
  fontSize = 0.5276mm,
)

```


![Rendered example of gdt::distance 2](/kcl-test-outputs/serial_test_example_fn_std-gdt-distance2.png)


