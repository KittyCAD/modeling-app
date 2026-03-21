---
title: "sketch2::circle"
subtitle: "Function in std::sketch2"
excerpt: "Create a circle in a sketch. The circle segment always has a starting point and sweeps counterclockwise from it."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a circle in a sketch. The circle segment always has a starting point and sweeps counterclockwise from it.

```kcl
sketch2::circle(
  start: Point2d,
  center: Point2d,
  construction?: bool,
): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point in two dimensional space. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point in two dimensional space. | Yes |
| `construction` | [`bool`](/docs/kcl-std/types/std-types-bool) | A boolean value. | No |

### Returns

[`Segment`](/docs/kcl-std/types/std-types-Segment) - A segment of a path in a sketch. It may be a line, arc, or other segment type.



