---
title: "gdt::straightness"
subtitle: "Function in std::gdt"
excerpt: "GD&T annotation specifying how straight a feature must be."
layout: manual
---

GD&T annotation specifying how straight a feature must be.

```kcl
gdt::straightness(
  tolerance: number(Length),
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

Straightness is a form tolerance. When applied to a planar face, every
line element of the face must lie between two parallel lines separated by
the given `tolerance`. When applied to an edge, the edge itself must lie
within that zone.

Straightness should usually be applied to edges. But depending on the view,
a face normal may appear like an edge.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount of deviation from perfectly straight that is acceptable. | Yes |
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

blockSketch = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 24mm])
  edge3 = line(start = [var 10mm, var 24mm], end = [var 0mm, var 24mm])
  edge4 = line(start = [var 0mm, var 24mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

blockRegion = region(point = [5mm, 3mm], sketch = blockSketch)
hide(blockSketch)
block = extrude(blockRegion, length = 10mm)
gdt::straightness(edges = [blockRegion.tags.edge2], tolerance = 0.05mm)

```


![Rendered example of gdt::straightness 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-straightness0.png)

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

block = extrude(region(point = [5mm, 3mm], sketch = blockProfile), length = 4mm, tagEnd = $top)
gdt::straightness(
  faces = [top],
  tolerance = 0.02mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::straightness 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-straightness1.png)

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

block = extrude(region(point = [5mm, 3mm], sketch = blockProfile), length = 4mm, tagEnd = $top)
sideEdge = getCommonEdge(faces = [block.sketch.tags.edge1, top])
gdt::straightness(
  edges = [sideEdge],
  tolerance = 0.05mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::straightness 2](/kcl-test-outputs/serial_test_example_fn_std-gdt-straightness2.png)


