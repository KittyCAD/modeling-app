---
title: "sketch2::diameter"
subtitle: "Function in std::sketch2"
excerpt: "Constrain the diameter of an arc or circle segment. Accepts a single arc or circle segment and constrains the distance from its center to its start point. Note: Diameter uses the same solver constraint as radius (distance between two points), but is stored as a separate constraint type for proper UI display."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain the diameter of an arc or circle segment. Accepts a single arc or circle segment and constrains the distance from its center to its start point. Note: Diameter uses the same solver constraint as radius (distance between two points), but is stored as a separate constraint type for proper UI display.

```kcl
sketch2::diameter(@points: Segment)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | A segment of a path in a sketch. It may be a line, arc, or other segment type. | Yes |



