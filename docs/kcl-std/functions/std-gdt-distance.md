---
title: "gdt::distance"
subtitle: "Function in std::gdt"
excerpt: "GD&T distance annotation for displaying measured edge lengths or distances between two entities."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

GD&T distance annotation for displaying measured edge lengths or distances between two entities.

```kcl
gdt::distance(
  tolerance: number(Length),
  from?: Face | TaggedFace | Edge,
  to?: Face | TaggedFace | Edge,
  edges?: [Edge; 1+],
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontPointSize?: number(_),
  fontScale?: number(_),
): [GdtAnnotation; 1+]
```

This is part of model-based definition (MBD).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The acceptable distance tolerance. | Yes |
| `from` | [`Face`](/docs/kcl-std/types/std-types-Face) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Edge`](/docs/kcl-std/types/std-types-Edge) | The face or edge to measure from. Must be used with `to`. The default position is the entity center. | No |
| `to` | [`Face`](/docs/kcl-std/types/std-types-Face) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Edge`](/docs/kcl-std/types/std-types-Edge) | The face or edge to measure to. Must be used with `from`. The default position is the entity center. | No |
| `edges` | [[`Edge`](/docs/kcl-std/types/std-types-Edge); 1+] | The edges whose lengths are annotated. Cannot be combined with `from` or `to`. | No |
| `precision` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of decimal places to display. The default is `3`. Must be greater than or equal to `0` and less than or equal to `9`. | No |
| `framePosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The position of the distance label relative to the measured geometry. The default is `[100mm, 100mm]`. | No |
| `framePlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane in which to display the distance. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The distance may be displayed in a plane parallel to the given plane. | No |
| `leaderScale` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Scale of the distance arrows. The default is `1.0`. Must be greater than `0`. | No |
| `fontPointSize` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The font point size to use for the annotation text rendering. The default is `36`. | No |
| `fontScale` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Scale to use for the annotation text after rendering with the point size. The default is `1.0`. Must be greater than `0`. | No |

### Returns

[[`GdtAnnotation`](/docs/kcl-std/types/std-types-GdtAnnotation); 1+]


### Examples

```kcl
@settings(experimentalFeatures = allow)

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
@settings(experimentalFeatures = allow)

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
lengthEdge = getCommonEdge(faces = [block.sketch.tags.edge1, top])
gdt::distance(
  edges = [lengthEdge],
  tolerance = 0.05mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::distance 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-distance1.png)


