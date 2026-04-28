---
title: "region"
subtitle: "Function in std::sketch"
excerpt: "Create a region from closed segments."
layout: manual
---

Create a region from closed segments.

```kcl
region(
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

Important: Creating a region using the `segments` parameter is currently
only supported when there is a single closed region in the sketch. If the
sketch may have multiple regions, use the `point` parameter instead. Until
this limitation is lifted, using a point to select a region is preferred.

To help allow the region's point to move with the sketch, which may be
created parametrically, consider creating a construction point in the sketch
and constraining it into place. Then you can refer to the point to create
the region.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `point` | `Point2d | Segment` | A point that is within the region's boundary. | No |
| `segments` | `[Segment; 1+]` | The first two segments that form the region's boundary. In case of a circle, the one circle segment that forms the region. This parameter is currently only supported when there is only one region in the sketch. If the sketch may have multiple regions, use the `point` parameter instead. | No |
| `intersectionIndex` | `number(_)` | Index of the intersection of the first segment with the second segment to use as the region's boundary. The default is `-1`, which uses the last intersection. This is only used when the `segments` argument is provided. | No |
| `direction` | `string` | `CCW` for counterclockwise, `CW` for clockwise. Default is `CCW`. This is only used when the `segments` argument is provided. | No |
| `sketch` | `any` | The sketch that the region is from. This is required when point is a `Point2d`. | No |

### Returns

`Sketch` - A sketch is a collection of paths.



