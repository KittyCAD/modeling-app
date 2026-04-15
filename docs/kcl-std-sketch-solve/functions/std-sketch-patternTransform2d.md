---
title: "patternTransform2d"
subtitle: "Function in std::sketch"
excerpt: "Just like `patternTransform`, but works on 2D sketches not 3D solids."
layout: manual
---

Just like `patternTransform`, but works on 2D sketches not 3D solids.

```kcl
patternTransform2d(
  @sketches: [Sketch; 1+],
  instances: number(_),
  transform: fn(number(_)): { },
  useOriginal?: boolean,
): [Sketch; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | `[Sketch; 1+]` | The sketch(es) to duplicate. | Yes |
| `instances` | `number(_)` | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `transform` | `fn(number(_)): { }` | How each replica should be transformed. The transform function takes a single parameter: an integer representing which number replication the transform is for. E.g. the first replica to be transformed will be passed the argument `1`. This simplifies your math: the transform function can rely on id `0` being the original instance passed into the `patternTransform`. See the examples. | Yes |
| `useOriginal` | `boolean` | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

`[Sketch; 1+]`



