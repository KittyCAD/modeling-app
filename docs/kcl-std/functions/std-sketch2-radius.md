---
title: "sketch2::radius"
subtitle: "Function in std::sketch2"
excerpt: "Constrain the radius of an arc segment. Accepts a single arc segment and constrains the distance from its center to its start point."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain the radius of an arc segment. Accepts a single arc segment and constrains the distance from its center to its start point.

```kcl
sketch2::radius(@points: Segment)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | A segment of a path in a sketch. It may be a line, arc, or other segment type. | Yes |



