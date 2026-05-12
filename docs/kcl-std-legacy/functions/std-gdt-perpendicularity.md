---
title: "gdt::perpendicularity"
subtitle: "Function in std::gdt"
excerpt: "GD&T perpendicularity annotation specifying how much faces or edges may deviate from perpendicular orientation relative to datum references."
layout: manual
---

GD&T perpendicularity annotation specifying how much faces or edges may deviate from perpendicular orientation relative to datum references.

```kcl
gdt::perpendicularity(
  tolerance: number(Length),
  faces?: [TaggedFace; 1+],
  edges?: [Edge; 1+],
  datums?: [string; 1+],
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontSize?: number(_),
): [GdtAnnotation; 1+]
```

This is part of model-based definition (MBD).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | `number(Length)` | The tolerance zone size for perpendicular orientation. | Yes |
| `faces` | `[TaggedFace; 1+]` | The faces to be annotated. | No |
| `edges` | `[Edge; 1+]` | The edges to be annotated. | No |
| `datums` | `[string; 1+]` | The datum references to display in the feature control frame. Supports up to primary, secondary, and tertiary datums. | No |
| `precision` | `number(_)` | The number of decimal places to display. The default is `3`. Must be greater than or equal to `0` and less than or equal to `9`. | No |
| `framePosition` | `Point2d` | The position of the feature control frame relative to the leader arrow. The default is `[100mm, 100mm]`. | No |
| `framePlane` | `Plane` | The plane in which to display the feature control frame. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The frame may be displayed in a plane parallel to the given plane. | No |
| `leaderScale` | `number(_)` | Scale of the leader. The default is `1.0`. Must be greater than `0`. | No |
| `fontSize` | `number(_)` | The font size to use for the annotation text rendering. The default is `36`. | No |

### Returns

`[GdtAnnotation; 1+]`


### Examples

```kcl
startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0], tag = $side)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> line(end = [0, -10])
  |> close()
  |> extrude(length = 5, tagEnd = $top)

gdt::datum(
  face = top,
  name = "A",
  framePosition = [8mm, 0mm],
  framePlane = XZ,
)
gdt::perpendicularity(
  faces = [side],
  tolerance = 0.05mm,
  datums = ["A"],
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::perpendicularity 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-perpendicularity0.png)


