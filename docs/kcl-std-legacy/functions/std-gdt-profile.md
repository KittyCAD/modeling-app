---
title: "gdt::profile"
subtitle: "Function in std::gdt"
excerpt: "GD&T profile annotation specifying how much edges may deviate from their ideal shape."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

GD&T profile annotation specifying how much edges may deviate from their ideal shape.

```kcl
gdt::profile(
  edges: [Edge; 1+],
  tolerance: number(Length),
  datums?: [string; 1+],
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
| `edges` | `[Edge; 1+]` | The edges to be annotated. | Yes |
| `tolerance` | `number(Length)` | The amount of deviation from an ideal profile that is acceptable. | Yes |
| `datums` | `[string; 1+]` | The datum references to display in the feature control frame. Supports up to primary, secondary, and tertiary datums. | No |
| `precision` | `number(_)` | The number of decimal places to display. The default is `3`. Must be greater than or equal to `0` and less than or equal to `9`. | No |
| `framePosition` | `Point2d` | The position of the feature control frame relative to the leader arrow. The default is `[100mm, 100mm]`. | No |
| `framePlane` | `Plane` | The plane in which to display the feature control frame. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The frame may be displayed in a plane parallel to the given plane. | No |
| `leaderScale` | `number(_)` | Scale of the leader. The default is `1.0`. Must be greater than `0`. | No |
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
  |> line(end = [0, 10], tag = $side2)
  |> line(end = [-10, 0])
  |> line(end = [0, -10])
  |> close()
  |> extrude(length = 5, tagEnd = $top)

profileEdge = getCommonEdge(faces = [side1, top])

gdt::profile(
  edges = [profileEdge],
  datums = ["A"],
  tolerance = 0.1mm,
  framePosition = [10mm, 20mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::profile 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-profile0.png)


