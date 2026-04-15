---
title: "solver::arc"
subtitle: "Function in std::solver"
excerpt: "Create a circular arc. The arc segment always sweeps counterclockwise from start to end. To change direction, swap the start and end points."
layout: manual
---

Create a circular arc. The arc segment always sweeps counterclockwise from start to end. To change direction, swap the start and end points.

```kcl
solver::arc(
  start: Point2d,
  end: Point2d,
  center: Point2d,
  construction?: bool,
): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | `Point2d` | The point where the arc begins. | Yes |
| `end` | `Point2d` | The point where the arc ends. | Yes |
| `center` | `Point2d` | The center of the circle the arc lies on. | Yes |
| `construction` | `bool` | Whether this segment is construction geometry rather than part of the modeled profile. | No |

### Returns

`Segment` - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.



