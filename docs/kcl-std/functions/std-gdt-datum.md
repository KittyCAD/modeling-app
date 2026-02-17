---
title: "gdt::datum"
subtitle: "Function in std::gdt"
excerpt: "GD&T datum feature."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

GD&T datum feature.

```kcl
gdt::datum(
  face: TaggedFace,
  name: string,
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontPointSize?: number(_),
  fontScale?: number(_),
): GdtAnnotation
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | The face to be annotated. | Yes |
| `name` | [`string`](/docs/kcl-std/types/std-types-string) | The name of the datum. | Yes |
| `framePosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The position of the feature control frame relative to the leader arrow. The default is `[100mm, 100mm]`. | No |
| `framePlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane in which to display the feature control frame. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The frame may be displayed in a plane parallel to the given plane. | No |
| `leaderScale` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Scale of the leader. The default is `1.0`. Must be greater than `0`. | No |
| `fontPointSize` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The font point size to use for the annotation text rendering. The default is `36`. | No |
| `fontScale` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Scale to use for the annotation text after rendering with the point size. The default is `1.0`. Must be greater than `0`. | No |

### Returns

[`GdtAnnotation`](/docs/kcl-std/types/std-types-GdtAnnotation) - A GD&T annotation.


### Examples

```kcl
@settings(experimentalFeatures = allow, defaultLengthUnit = in)

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


