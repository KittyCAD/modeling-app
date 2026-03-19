---
title: "sketch2::coincident"
subtitle: "Function in std::sketch2"
excerpt: "Constrain points, or a point and a segment to be coincident."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain points, or a point and a segment to be coincident.

```kcl
sketch2::coincident(@points: [Segment; 2])
```

Supports two points, or one point and one segment (line/arc).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2] |  | Yes |



