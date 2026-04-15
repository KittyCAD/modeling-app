---
title: "gdt::flatness"
subtitle: "Function in std::gdt"
excerpt: "GD&T annotation specifying how flat faces should be."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

GD&T annotation specifying how flat faces should be.

```kcl
gdt::flatness(
  faces: [TaggedFace; 1+],
  tolerance: number(Length),
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontPointSize?: number(_),
  fontScale?: number(_),
): [GdtAnnotation; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `faces` | `[TaggedFace; 1+]` | The faces to be annotated. | Yes |
| `tolerance` | `number(Length)` | The amount of deviation from a perfect plane that is acceptable. | Yes |
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
gdt::flatness(
  faces = [top],
  tolerance = 0.05mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::flatness 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-flatness3.png)


