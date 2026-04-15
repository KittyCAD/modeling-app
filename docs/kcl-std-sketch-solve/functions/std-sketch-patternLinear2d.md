---
title: "patternLinear2d"
subtitle: "Function in std::sketch"
excerpt: "Repeat a 2-dimensional sketch along some dimension, with a dynamic amount of distance between each repetition, some specified number of times."
layout: manual
---

Repeat a 2-dimensional sketch along some dimension, with a dynamic amount of distance between each repetition, some specified number of times.

```kcl
patternLinear2d(
  @sketches: [Sketch; 1+],
  instances: number(_),
  distance: number(Length),
  axis: Axis2d | Point2d,
  useOriginal?: bool,
): [Sketch; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | `[Sketch; 1+]` | The sketch(es) to duplicate. | Yes |
| `instances` | `number(_)` | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `distance` | `number(Length)` | Distance between each repetition. Also known as 'spacing'. | Yes |
| `axis` | `Axis2d | Point2d` | The axis of the pattern. A 2D vector. | Yes |
| `useOriginal` | `bool` | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

`[Sketch; 1+]`



