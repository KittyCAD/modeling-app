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
  fontSize?: number(Length),
): [GdtAnnotation; 1+]
```

This is part of model-based definition (MBD).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `annotation` | [`string`](/docs/kcl-std/types/std-types-string) | The annotation text to display. | Yes |
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 1+] | The faces to be annotated. | No |
| `edges` | [[`Edge`](/docs/kcl-std/types/std-types-Edge); 1+] | The edges to be annotated. | No |
| `framePosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The position of the annotation relative to the leader arrow. The default is `[100mm, 100mm]`. | No |
| `framePlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane in which to display the annotation. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The annotation may be displayed in a plane parallel to the given plane. | No |
| `leaderScale` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Scale of the leader. The default is `1.0`. Must be greater than `0`. | No |
| `fontSize` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The model-space height to use for annotation text. The default is `10mm`. Explicit units are supported; bare numbers use the file's default length unit. This changes the scene size, not the internal raster texture quality. | No |

### Returns

[[`GdtAnnotation`](/docs/kcl-std/types/std-types-GdtAnnotation); 1+]


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

```kcl
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
gdt::annotation(
  edges = [sideEdge],
  annotation = "Deburr edge",
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::annotation 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-annotation1.png)


