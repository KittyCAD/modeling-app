---
title: "gdt::annotation"
subtitle: "Function in std::gdt"
excerpt: "GD&T annotation for attaching manufacturing text to faces or edges."
layout: manual
---

GD&T annotation for attaching manufacturing text to faces or edges.

```kcl
gdt::annotation(
  annotation: string,
  faces?: [TaggedFace; 1+],
  edges?: [Edge; 1+],
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
| `annotation` | `string` | The annotation text to display. | Yes |
| `faces` | `[TaggedFace; 1+]` | The faces to be annotated. | No |
| `edges` | `[Edge; 1+]` | The edges to be annotated. | No |
| `framePosition` | `Point2d` | The position of the annotation relative to the leader arrow. The default is `[100mm, 100mm]`. | No |
| `framePlane` | `Plane` | The plane in which to display the annotation. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The annotation may be displayed in a plane parallel to the given plane. | No |
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

gdt::annotation(
  faces = [top],
  annotation = "Break all sharp edges",
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::annotation 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-annotation0.png)


