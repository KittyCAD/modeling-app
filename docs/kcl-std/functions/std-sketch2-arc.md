---
title: "sketch2::arc"
subtitle: "Function in std::sketch2"
excerpt: "A circular arc. The arc segment always sweeps counterclockwise from start to end. To change direction, swap the start and end points."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

A circular arc. The arc segment always sweeps counterclockwise from start to end. To change direction, swap the start and end points.

```kcl
sketch2::arc(
  start: Point2d,
  end: Point2d,
  center: Point2d,
  construction?: bool,
): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point in two dimensional space. | Yes |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point in two dimensional space. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point in two dimensional space. | Yes |
| `construction` | [`bool`](/docs/kcl-std/types/std-types-bool) | A boolean value. | No |

### Returns

[`Segment`](/docs/kcl-std/types/std-types-Segment) - A segment of a path in a sketch. It may be a line, arc, or other segment type.



