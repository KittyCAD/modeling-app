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


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the vector::cross function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-vector-cross0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-vector-cross0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


