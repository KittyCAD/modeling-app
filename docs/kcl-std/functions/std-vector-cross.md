---
title: "vector::cross"
subtitle: "Function in std::vector"
excerpt: "Find the cross product of two 3D points or vectors."
layout: manual
---

Find the cross product of two 3D points or vectors.

```kcl
vector::cross(
  @u: Point3d,
  v: Point3d,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `u` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | A point in three dimensional space. | Yes |
| `v` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | A point in three dimensional space. | Yes |


### Examples

```kcl
vx = [1, 0, 0]
vy = [0, 1, 0]
vz = vector::cross(vx, v = vy)
assert(vz[0], isEqualTo = 0)
assert(vz[1], isEqualTo = 0)
assert(vz[2], isEqualTo = 1)

```




