---
title: "gdt::radius"
subtitle: "Function in std::gdt"
excerpt: "Annotate the measured radius of a circular edge or cylindrical face. The value is measured from the selected geometry each time the model executes. This is part of model-based definition (MBD)."
layout: manual
---

Annotate the measured radius of a circular edge or cylindrical face. The value is measured from the selected geometry each time the model executes. This is part of model-based definition (MBD).

```kcl
gdt::radius(
  target: Face | TaggedFace | Edge | any,
  tolerance?: number(Length),
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  leaderScale?: number(_),
  fontSize?: number(Length),
  annotationName?: string,
): GdtAnnotation
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `target` | [`Face`](/docs/kcl-std/types/std-types-Face) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`any`](/docs/kcl-std/types/std-types-any) | The circular edge or cylindrical face to annotate. Edges may use an adjacent-face specifier. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Optional dimensional tolerance. Omit it or use zero to hide the tolerance. | No |
| `precision` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Decimal places to display, from 0 to 9. Defaults to 3. | No |
| `framePosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Offset of the label from the leader in the display plane. Defaults to [20mm, 20mm]. | No |
| `framePlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | Display plane. Defaults to XY; the annotation may lie in a parallel plane. | No |
| `leaderScale` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Arrow scale. Must be greater than zero; defaults to 1. | No |
| `fontSize` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Model-space text height. Must be greater than zero; defaults to 10mm. | No |
| `annotationName` | [`string`](/docs/kcl-std/types/std-types-string) | Human-friendly annotation name in exports and model metadata. | No |

### Returns

[`GdtAnnotation`](/docs/kcl-std/types/std-types-GdtAnnotation) - A GD&T annotation created by one of the [`gdt` functions](/docs/kcl-std/modules/std-gdt).


### Examples

```kcl
@settings(kclVersion = 2.0)

profile = sketch(on = XY) {
  rim = arc(start = [var 10mm, var 0mm], end = [var -10mm, var 0mm], center = [var 0mm, var 0mm])
  closing = line(start = [var -10mm, var 0mm], end = [var 10mm, var 0mm])
}
solid = extrude(region(segments = [profile.rim, profile.closing]), length = 5mm, tagEnd = $top)
gdt::radius(
  target = {
    sideFaces = [solid.sketch.tags.rim, solid.faces.top]
  },
  tolerance = 0.05mm,
  precision = 2,
  framePlane = XY,
)

```


![Rendered example of gdt::radius 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-radius0.png)


