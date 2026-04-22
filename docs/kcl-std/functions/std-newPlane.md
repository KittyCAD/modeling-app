---
title: "newPlane"
subtitle: "Function in std"
excerpt: "Create a new plane."
layout: manual
---

Create a new plane.

```kcl
newPlane(
  origin: Point3d,
  xAxis: Point3d,
  yAxis: Point3d,
): Plane
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `origin` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The origin of the new plane. | Yes |
| `xAxis` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The X axis of the new plane. | Yes |
| `yAxis` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The Y axis of the new plane. | Yes |

### Returns

[`Plane`](/docs/kcl-std/types/std-types-Plane) - An abstract plane.


### Examples

```kcl
myPlane = newPlane(origin = { x = 38.1mm, y = -38.1mm, z = 76.2mm }, xAxis = { x = -0.5, y = -0.5, z = 0 }, yAxis = { x = 0, y = 0.5, z = 0.5 })

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the newPlane function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-newPlane0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-newPlane0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


