---
title: "sketch2::region"
subtitle: "Function in std::sketch2"
excerpt: "Create a region from closed segments."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a region from closed segments.

```kcl
sketch2::region(
  point?: Point2d | Segment,
  segments?: [Segment; 1+],
  intersectionIndex?: number(_),
  direction?: string,
  sketch?: any,
): Sketch
```

Form the region from sketch block segments that have a given point within a
closed boundary. When using a 2D point, not a point from the sketch, the
`sketch` parameter is required to specify which sketch the region is from.

Alternatively, form the region by tracing the first segment from its start
point to the intersection with the second segment, and turn at each
intersection using the `direction` until returning back to the first
segment.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `point` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | A point that is within the region's boundary. | No |
| `segments` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 1+] | The first two segments that form the region's boundary. In case of a circle, the one circle segment that forms the region. | No |
| `intersectionIndex` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Index of the intersection of the first segment with the second segment to use as the region's boundary. The default is `-1`, which uses the last intersection. | No |
| `direction` | [`string`](/docs/kcl-std/types/std-types-string) | `CCW` for counterclockwise, `CW` for clockwise. Default is `CCW`. | No |
| `sketch` | [`any`](/docs/kcl-std/types/std-types-any) | The sketch that the region is from. This is required when point is a [`Point2d`](/docs/kcl-std/types/std-types-Point2d). | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.



