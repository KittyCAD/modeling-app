---
title: "gdt::note"
subtitle: "Function in std::gdt"
excerpt: "GD&T note for adding free-floating manufacturing text that is not attached to a face or edge."
layout: manual
---

GD&T note for adding free-floating manufacturing text that is not attached to a face or edge.

```kcl
gdt::note(
  note: string,
  framePlane?: Plane,
  framePosition?: Point2d,
  fontSize?: number(Length),
): GdtAnnotation
```

This is part of model-based definition (MBD). Unlike `gdt::annotation`, a note has no leader
and is placed directly on a plane. By default it lives on the world `XY` plane, but any plane
(a standard plane like `XZ`/`YZ`, or a user-defined plane) can be supplied via `framePlane`.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `note` | [`string`](/docs/kcl-std/types/std-types-string) | The note text to display. | Yes |
| `framePlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane the note lies in. The default is `XY`. Other standard planes like `XZ` and `YZ`, or a user-defined plane, can also be used. | No |
| `framePosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The 2D position of the note within the plane, in the plane's local coordinates. The default is `[100mm, 100mm]`. | No |
| `fontSize` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The model-space height to use for the note text. The default is `10mm`. Explicit units are supported; bare numbers use the file's default length unit. This changes the scene size, not the internal raster texture quality. | No |

### Returns

[`GdtAnnotation`](/docs/kcl-std/types/std-types-GdtAnnotation) - A GD&T annotation created by one of the [`gdt` functions](/docs/kcl-std/modules/std-gdt).


### Examples

```kcl
@settings(kclVersion = 2.0)

// A note on the default world (XY) plane.
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
block = extrude(region(point = [5mm, 3mm], sketch = blockProfile), length = 4mm)

gdt::note(note = "Note on XY", framePosition = [12mm, 8mm])

```


![Rendered example of gdt::note 0](/kcl-test-outputs/serial_test_example_fn_std-gdt-note0.png)

```kcl
@settings(kclVersion = 2.0)

// A note on a user-defined plane.
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
block = extrude(region(point = [5mm, 3mm], sketch = blockProfile), length = 4mm)

notePlane = offsetPlane(XZ, offset = 12mm)
gdt::note(note = "Note on custom Plane", framePlane = notePlane, framePosition = [12mm, 8mm])

```


![Rendered example of gdt::note 1](/kcl-test-outputs/serial_test_example_fn_std-gdt-note1.png)
