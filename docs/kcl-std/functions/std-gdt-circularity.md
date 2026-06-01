---
title: "gdt::circularity"
subtitle: "Function in std::gdt"
excerpt: "GD&T annotation specifying how circular (round) a feature must be."
layout: manual
---

GD&T annotation specifying how circular (round) a feature must be.

```kcl
gdt::circularity(
  tolerance: number(Length),
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

Circularity is a form tolerance. It controls how much a feature of
revolution may deviate from a perfect circle. When applied to a circular
edge, every point of the edge must lie between two concentric circles whose
radii differ by the given `tolerance`. When applied to a round face, such as
the wall of a cylinder or cone, every cross-section perpendicular to the
axis must meet that same requirement.

Circularity is a form tolerance, so it does not reference datums.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount of deviation from a perfect circle that is acceptable. | Yes |
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

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinderRegion = region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch)
hide(cylinderSketch)
cylinder = extrude(cylinderRegion, length = 10mm)
gdt::circularity(edges = [cylinderRegion.tags.perimeter], tolerance = 0.05mm, framePosition = [-12mm, 8mm])

```


![Rendered example of gdt::circularity 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-circularity0.png)

```kcl
@settings(kclVersion = 2.0)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinder = extrude(region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch), length = 10mm)
gdt::circularity(
  faces = [cylinder.sketch.tags.perimeter],
  tolerance = 0.02mm,
  framePosition = [-12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::circularity 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-circularity1.png)

```kcl
@settings(kclVersion = 2.0)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinder = extrude(region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch), length = 10mm, tagEnd = $top)
topEdge = getCommonEdge(faces = [cylinder.sketch.tags.perimeter, top])
gdt::circularity(
  edges = [topEdge],
  tolerance = 0.05mm,
  framePosition = [-12mm, 8mm],
  framePlane = XZ,
)

```


![Rendered example of gdt::circularity 2](/kcl-test-outputs/serial_test_example_fn_std-gdt-circularity2.png)


