---
title: "filletCorner3d"
subtitle: "Function in std::sketch"
excerpt: "Append two straight legs joined by a circular fillet of the given radius. The legs run from the current path position toward `cornerAbsolute`, then toward `endAbsolute`. Both are shortened to meet the arc tangentially. Changing either point recomputes the arc's plane and both tangent points. The radius must leave a nonzero straight portion on both legs. Collinear corners are rejected. Existing path segments are not modified, and this function does not enforce tangency to a segment preceding the new section."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Append two straight legs joined by a circular fillet of the given radius. The legs run from the current path position toward `cornerAbsolute`, then toward `endAbsolute`. Both are shortened to meet the arc tangentially. Changing either point recomputes the arc's plane and both tangent points. The radius must leave a nonzero straight portion on both legs. Collinear corners are rejected. Existing path segments are not modified, and this function does not enforce tangency to a segment preceding the new section.

```kcl
filletCorner3d(
  @path: Path3d,
  cornerAbsolute: Point3d,
  endAbsolute: Point3d,
  radius: number(Length),
): Path3d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `path` | [`Path3d`](/docs/kcl-std/types/std-types-Path3d) | A continuous spatial path of straight lines and circular arcs, authored with `startPath3d`, `line3d`, and `arc3d`. Use it as the trajectory of `sweep`. Coordinates are in world space. A spatial path does not define a filled region. | Yes |
| `cornerAbsolute` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | A point in three dimensional space. | Yes |
| `endAbsolute` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | A point in three dimensional space. | Yes |
| `radius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`Path3d`](/docs/kcl-std/types/std-types-Path3d) - A continuous spatial path of straight lines and circular arcs, authored with `startPath3d`, `line3d`, and `arc3d`. Use it as the trajectory of `sweep`. Coordinates are in world space. A spatial path does not define a filled region.


### Examples

```kcl
@settings(kclVersion = 3.0, experimentalFeatures = allow)

corner = [0mm, 0mm, 60mm]
end = [15mm, 25mm, 65mm]
route = startPath3d(at = [0mm, 0mm, 0mm])
  |> filletCorner3d(cornerAbsolute = corner, endAbsolute = end, radius = 10mm)

```




