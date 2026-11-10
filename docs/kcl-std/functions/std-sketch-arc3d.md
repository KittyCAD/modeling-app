---
title: "arc3d"
subtitle: "Function in std::sketch"
excerpt: "Append a circular arc from the current position, through `interiorAbsolute`, to `endAbsolute`. The three distinct, non-collinear world points determine the arc's plane and traversal, including arcs greater than 180 degrees."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Append a circular arc from the current position, through `interiorAbsolute`, to `endAbsolute`. The three distinct, non-collinear world points determine the arc's plane and traversal, including arcs greater than 180 degrees.

```kcl
arc3d(
  @path: Path3d,
  interiorAbsolute: Point3d,
  endAbsolute: Point3d,
): Path3d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `path` | [`Path3d`](/docs/kcl-std/types/std-types-Path3d) | A continuous spatial path of straight lines and circular arcs, authored with `startPath3d`, `line3d`, and `arc3d`. Use it as the trajectory of `sweep`. Coordinates are in world space. A spatial path does not define a filled region. | Yes |
| `interiorAbsolute` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | A point in three dimensional space. | Yes |
| `endAbsolute` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | A point in three dimensional space. | Yes |

### Returns

[`Path3d`](/docs/kcl-std/types/std-types-Path3d) - A continuous spatial path of straight lines and circular arcs, authored with `startPath3d`, `line3d`, and `arc3d`. Use it as the trajectory of `sweep`. Coordinates are in world space. A spatial path does not define a filled region.


### Examples

```kcl
@settings(kclVersion = 3.0, experimentalFeatures = allow)

route = startPath3d(at = [0mm, 0mm, 0mm])
  |> line3d(end = [0mm, 0mm, 20mm])
  |> arc3d(interiorAbsolute = [5mm, 0mm, 25mm], endAbsolute = [10mm, 0mm, 20mm])
  |> line3d(end = [0mm, 10mm, -20mm])

```




