---
title: "solver::line"
subtitle: "Function in std::solver"
excerpt: "Create a straight line segment in a sketch."
layout: manual
---

Create a straight line segment in a sketch.

```kcl
solver::line(
  start: Point2d,
  end: Point2d,
  construction?: bool,
): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | `Point2d` | The segment's start point in sketch coordinates. | Yes |
| `end` | `Point2d` | The segment's end point in sketch coordinates. | Yes |
| `construction` | `bool` | Whether this segment is construction geometry rather than part of the modeled profile. | No |

### Returns

`Segment` - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.



