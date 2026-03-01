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
  segments: [Segment; 2],
  intersectionIndex?: number(_),
  direction?: string,
)
```

Form the region by tracing the first segment from its start point to the
intersection with the second segment, and turn at each intersection using
 the `direction` until returning back to the first segment.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `segments` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2] | The first two segments that form the region's boundary. | Yes |
| `intersectionIndex` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Index of the intersection of the first segment with the second segment to use as the region's boundary. The default is `-1`, which uses the last intersection. | No |
| `direction` | [`string`](/docs/kcl-std/types/std-types-string) | `CCW` for counterclockwise, `CW` for clockwise. Default is `CCW`. | No |



