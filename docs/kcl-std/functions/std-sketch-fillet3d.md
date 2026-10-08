---
title: "fillet3d"
subtitle: "Function in std::sketch"
excerpt: "Round all interior line-line corners of an open 3D route. Each corner replaces the ends of its two straight legs with a circular arc of the given radius. Editing the line endpoints recomputes both tangent joins. Existing arcs retain their points, radius, and traversal; joins involving arcs must already be tangent. Straight continuations are retained. Reversals, closed routes, sharp arc joins, and radii that consume a leg or overlap neighboring fillets are rejected. The input route is consumed and hidden; use the returned rounded path."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Round all interior line-line corners of an open 3D route. Each corner replaces the ends of its two straight legs with a circular arc of the given radius. Editing the line endpoints recomputes both tangent joins. Existing arcs retain their points, radius, and traversal; joins involving arcs must already be tangent. Straight continuations are retained. Reversals, closed routes, sharp arc joins, and radii that consume a leg or overlap neighboring fillets are rejected. The input route is consumed and hidden; use the returned rounded path.

```kcl
fillet3d(
  @path: Path3d,
  radius: number(Length),
): Path3d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `path` | [`Path3d`](/docs/kcl-std/types/std-types-Path3d) | A continuous spatial path of straight lines and circular arcs, authored with `startPath3d`, `line3d`, and `arc3d`. Use it as the trajectory of `sweep`. Coordinates are in world space. A spatial path does not define a filled region. | Yes |
| `radius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`Path3d`](/docs/kcl-std/types/std-types-Path3d) - A continuous spatial path of straight lines and circular arcs, authored with `startPath3d`, `line3d`, and `arc3d`. Use it as the trajectory of `sweep`. Coordinates are in world space. A spatial path does not define a filled region.


### Examples

```kcl
@settings(kclVersion = 3.0, experimentalFeatures = allow)

route = startPath3d(at = [0mm, 0mm, 0mm])
  |> line3d(endAbsolute = [0mm, 0mm, 40mm])
  |> tangentialArc3d(end = [20mm, 0mm, 20mm])
  |> line3d(endAbsolute = [60mm, 0mm, 60mm])
  |> line3d(endAbsolute = [60mm, 40mm, 60mm])
  |> fillet3d(radius = 6mm)

```




