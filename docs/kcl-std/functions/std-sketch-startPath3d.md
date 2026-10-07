---
title: "startPath3d"
subtitle: "Function in std::sketch"
excerpt: "Start a continuous 3D path in world coordinates, without a sketch plane or constraints. Extend it with `line3d` and `arc3d`, then use it as the path of `sweep`."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Start a continuous 3D path in world coordinates, without a sketch plane or constraints. Extend it with `line3d` and `arc3d`, then use it as the path of `sweep`.

```kcl
startPath3d(at: Point3d): Path3d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `at` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | A point in three dimensional space. | Yes |

### Returns

[`Path3d`](/docs/kcl-std/types/std-types-Path3d) - A continuous spatial path of straight lines and circular arcs, authored with `startPath3d`, `line3d`, and `arc3d`. Use it as the trajectory of `sweep`. Coordinates are in world space. A spatial path does not define a filled region.


### Examples

```kcl
@settings(kclVersion = 3.0, experimentalFeatures = allow)

route = startPath3d(at = [0mm, 0mm, 0mm])
  |> line3d(end = [0mm, 0mm, 20mm])

```




