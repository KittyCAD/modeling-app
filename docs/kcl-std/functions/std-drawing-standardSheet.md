---
title: "drawing::standardSheet"
subtitle: "Function in std::drawing"
excerpt: "Create a drawing sheet from a standard paper size."
layout: manual
---

Create a drawing sheet from a standard paper size.

**Added in KCL 4.0.**

```kcl
drawing::standardSheet(
  size: SheetSize,
  orientation: SheetOrientation,
): Sheet
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `size` | [`SheetSize`](/docs/kcl-std/types/std-drawing-SheetSize) | The standard paper size. | Yes |
| `orientation` | [`SheetOrientation`](/docs/kcl-std/types/std-drawing-SheetOrientation) | The orientation of the sheet. | Yes |

### Returns

[`Sheet`](/docs/kcl-std/types/std-drawing-Sheet) - An opaque drawing sheet. Square sheets retain their selected orientation.


### Examples

```kcl
@settings(kclVersion = "4.0-preview")

sheet = drawing::standardSheet(size = drawing::SheetSize::IsoA4, orientation = drawing::SheetOrientation::Portrait)

```




