---
title: "drawing::customSheet"
subtitle: "Function in std::drawing"
excerpt: "Create a drawing sheet from two side lengths and a name."
layout: manual
---

Create a drawing sheet from two side lengths and a name.

**Added in KCL 4.0.**

```kcl
drawing::customSheet(
  width: number(Length),
  height: number(Length),
  orientation: SheetOrientation,
  name: string,
): Sheet
```

Both lengths must be finite and positive.
The selected orientation determines which side is the width of the resulting sheet.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `width` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The width of the paper before applying the orientation. | Yes |
| `height` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The height of the paper before applying the orientation. | Yes |
| `orientation` | [`SheetOrientation`](/docs/kcl-std/types/std-drawing-SheetOrientation) | The orientation of the sheet. | Yes |
| `name` | [`string`](/docs/kcl-std/types/std-types-string) | A human-readable name that must be nonblank after trimming whitespace. | Yes |

### Returns

[`Sheet`](/docs/kcl-std/types/std-drawing-Sheet) - An opaque drawing sheet. Square sheets retain their selected orientation.


### Examples

```kcl
@settings(kclVersion = "4.0-preview")

sheet = drawing::customSheet(
  width = 200mm,
  height = 300mm,
  orientation = drawing::SheetOrientation::Landscape,
  name = "Assembly detail",
)

```




