---
title: "gdt::datum"
subtitle: "Function in std::gdt"
excerpt: "GD&T datum feature."
layout: manual
---

GD&T datum feature.

```kcl
gdt::datum(
  face: TaggedFace,
  name: string,
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontSize?: number(_),
): GdtAnnotation
```

This is part of model-based definition (MBD).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `face` | `TaggedFace` | The face to be annotated. | Yes |
| `name` | `string` | The name of the datum. | Yes |
| `framePosition` | `Point2d` | The position of the feature control frame relative to the leader arrow. The default is `[100mm, 100mm]`. | No |
| `framePlane` | `Plane` | The plane in which to display the feature control frame. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The frame may be displayed in a plane parallel to the given plane. | No |
| `leaderScale` | `number(_)` | Scale of the leader. The default is `1.0`. Must be greater than `0`. | No |
| `fontSize` | `number(_)` | The font size to use for the annotation text rendering. The default is `36`. | No |

### Returns

`GdtAnnotation` - A GD&T annotation created by one of the `gdt` functions.


### Examples

```kcl
width = 5

startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [width, 0], tag = $side1)
  |> line(end = [0, width], tag = $side2)
  |> line(end = [-width, 0], tag = $side3)
  |> line(end = [0, -width], tag = $side4)
  |> close()
  |> extrude(length = 5, tagStart = $bottom, tagEnd = $top)

gdt::datum(
  face = side2,
  name = "A",
  framePosition = [5, 0],
  framePlane = XZ,
)

```


![Rendered example of gdt::datum 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-datum0.png)


