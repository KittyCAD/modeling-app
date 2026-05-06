---
title: "solver::circle"
subtitle: "Function in std::solver"
excerpt: "Create a circle in a sketch. The circle segment always has a starting point and sweeps counterclockwise from it."
layout: manual
---

Create a circle in a sketch. The circle segment always has a starting point and sweeps counterclockwise from it.

```kcl
solver::circle(
  start: Point2d,
  center: Point2d,
  construction?: bool,
): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | `Point2d` | A point on the circle that sets where the circle starts. | Yes |
| `center` | `Point2d` | The center of the circle. | Yes |
| `construction` | `bool` | Whether this segment is construction geometry rather than part of the modeled profile. | No |

### Returns

`Segment` - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.



