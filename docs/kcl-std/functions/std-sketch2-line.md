---
title: "sketch2::line"
subtitle: "Function in std::sketch2"
excerpt: ""
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.



```kcl
sketch2::line(
  start: Point2d,
  end?: Point2d,
  midpoint?: Point2d,
  construction?: bool,
): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point in two dimensional space. | Yes |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point in two dimensional space. | No |
| `midpoint` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point in two dimensional space. | No |
| `construction` | [`bool`](/docs/kcl-std/types/std-types-bool) | A boolean value. | No |

### Returns

[`Segment`](/docs/kcl-std/types/std-types-Segment) - A segment of a path in a sketch. It may be a line, arc, or other segment type.



