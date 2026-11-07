---
title: "drawing::sheet"
subtitle: "Function in std::drawing"
excerpt: "Create a drawing sheet of a standard paper size."
layout: manual
---

Create a drawing sheet of a standard paper size.

**Added in KCL 3.0.**

```kcl
drawing::sheet(
  @size: PaperSize,
  orientation?: Orientation,
): Sheet
```

Dimensions retain their physical meaning regardless of the program's default
length unit. Creating a sheet does not create model geometry.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `size` | [`PaperSize`](/docs/kcl-std/types/std-drawing-PaperSize) | The standard size of the paper. | Yes |
| `orientation` | [`Orientation`](/docs/kcl-std/types/std-view-Orientation) | Landscape by default; portrait places the paper's shorter edge horizontally. | No |

### Returns

[`Sheet`](/docs/kcl-std/types/std-drawing-Sheet) - A paper sheet, with physical width and height in millimeters.


### Examples

```kcl
@settings(kclVersion = 3.0)

detail = drawing::sheet(drawing::PaperSize::A4)
assembly = drawing::sheet(drawing::PaperSize::Letter, orientation = drawing::Orientation::Landscape)

```


![Rendered example of drawing::sheet 0](/kcl-test-outputs/serial_test_example_fn_std-drawing-sheet0.png)


