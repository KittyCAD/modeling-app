---
title: "gdt::runout"
subtitle: "Function in std::gdt"
excerpt: "GD&T annotation specifying circular runout relative to a datum axis."
layout: manual
---

GD&T annotation specifying circular runout relative to a datum axis.

```kcl
gdt::runout(
  tolerance: number(Length),
  datums: [string; 1+],
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

Runout controls how much a round feature may vary as it rotates around a
referenced datum axis. It may be applied to circular edges or round faces,
such as the wall of a cylinder. Datum references are required.

Runout is applied regardless of feature size and does not use MMC or LMC.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The circular runout relative to the datum axis that is acceptable. | Yes |
| `datums` | [[`string`](/docs/kcl-std/types/std-types-string); 1+] | The datum references to display in the feature control frame. Supports up to primary, secondary, and tertiary datums. | Yes |
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

annotationPlane = offsetPlane(XZ, offset = 24mm)

controlledSketch = sketch(on = YZ) {
  upperPerimeter = arc(start = [var 10mm, var 0mm], end = [var -10mm, var 0mm], center = [var 0mm, var 0mm])
  lowerPerimeter = arc(start = [var -10mm, var 0mm], end = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([
    upperPerimeter.end,
    lowerPerimeter.start
  ])
  coincident([
    lowerPerimeter.end,
    upperPerimeter.start
  ])
}

controlledShaft = extrude(
  region(point = [0mm, 1mm], sketch = controlledSketch),
  length = -58mm,
  tagStart = $controlledShoulder,
  tagEnd = $controlledFreeEnd,
)

controlledUpperShoulderEdge = getCommonEdge(faces = [
  controlledShaft.sketch.tags.upperPerimeter,
  controlledShoulder
])

datumSketch = sketch(on = YZ) {
  perimeter = circle(start = [var 18mm, var 0mm], center = [var 0mm, var 0mm])
}

datumShaft = extrude(region(point = datumSketch.perimeter.center, sketch = datumSketch), length = 36mm, tagEnd = $datumEnd)

gdt::datum(
  face = datumShaft.sketch.tags.perimeter,
  name = "A",
  framePosition = [18mm, -28mm],
  framePlane = annotationPlane,
  leaderScale = 1.15,
  fontSize = 6mm,
)

gdt::runout(
  edges = [controlledUpperShoulderEdge],
  tolerance = 0.2mm,
  datums = ["A"],
  precision = 1,
  framePosition = [12mm, 48mm],
  framePlane = annotationPlane,
  leaderScale = 1.15,
  fontSize = 6mm,
)

```


![Rendered example of gdt::runout 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-runout0.png)


