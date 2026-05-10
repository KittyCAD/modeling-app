---
title: "gdt::dimension"
subtitle: "Function in std::gdt"
excerpt: "GD&T dimension annotation for displaying a measured basic dimension on edges."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

GD&T dimension annotation for displaying a measured basic dimension on edges.

```kcl
gdt::dimension(
  edges: [Edge; 1+],
  tolerance: number(Length),
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
| `edges` | `[Edge; 1+]` | The edges whose lengths are annotated. | Yes |
| `tolerance` | `number(Length)` | The acceptable dimensional tolerance. | Yes |
| `precision` | `number(_)` | The number of decimal places to display. The default is `3`. Must be greater than or equal to `0` and less than or equal to `9`. | No |
| `framePosition` | `Point2d` | The position of the dimension label relative to the measured edge. The default is `[100mm, 100mm]`. | No |
| `framePlane` | `Plane` | The plane in which to display the dimension. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The dimension may be displayed in a plane parallel to the given plane. | No |
| `leaderScale` | `number(_)` | Scale of the dimension arrows. The default is `1.0`. Must be greater than `0`. | No |
| `fontPointSize` | `number(_)` | The font point size to use for the annotation text rendering. The default is `36`. | No |
| `fontScale` | `number(_)` | Scale to use for the annotation text after rendering with the point size. The default is `1.0`. Must be greater than `0`. | No |

### Returns

`[GdtAnnotation; 1+]`


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
gdt::dimension(
  edges = [lengthEdge],
  tolerance = 0.05mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::dimension 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-dimension0.png)


