---
title: "line3d"
subtitle: "Function in std::sketch"
excerpt: "Append a straight segment to a 3D path. Supply exactly one of `end` (an offset from the current position) or `endAbsolute` (a world coordinate)."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Append a straight segment to a 3D path. Supply exactly one of `end` (an offset from the current position) or `endAbsolute` (a world coordinate).

```kcl
line3d(
  @path: Path3d,
  end?: Point3d,
  endAbsolute?: Point3d,
): Path3d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `path` | [`Path3d`](/docs/kcl-std/types/std-types-Path3d) | A continuous spatial path of straight lines and circular arcs, authored with `startPath3d`, `line3d`, and `arc3d`. Use it as the trajectory of `sweep`. Coordinates are in world space. A spatial path does not define a filled region. | Yes |
| `end` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | A point in three dimensional space. | No |
| `endAbsolute` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | A point in three dimensional space. | No |

### Returns

[`Path3d`](/docs/kcl-std/types/std-types-Path3d) - A continuous spatial path of straight lines and circular arcs, authored with `startPath3d`, `line3d`, and `arc3d`. Use it as the trajectory of `sweep`. Coordinates are in world space. A spatial path does not define a filled region.


### Examples

```kcl
@settings(kclVersion = 3.0, experimentalFeatures = allow)

route = startPath3d(at = [0mm, 0mm, 0mm])
  |> line3d(end = [0mm, 0mm, 20mm])
  |> line3d(endAbsolute = [10mm, 5mm, 30mm])

```




