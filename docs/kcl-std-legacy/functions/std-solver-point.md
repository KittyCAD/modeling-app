---
title: "solver::point"
subtitle: "Function in std::solver"
excerpt: "Create a point in a sketch."
layout: manual
---

Create a point in a sketch.

```kcl
solver::point(at: Point2d): Segment
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `at` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The point's position in the sketch's local 2D coordinate system. | Yes |

### Returns

[`Segment`](/docs/kcl-std/types/std-types-Segment) - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.



