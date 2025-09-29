---
title: "patternCircular3d"
subtitle: "Function in std::solid"
excerpt: "Repeat a 3-dimensional solid some number of times along a partial or complete circle some specified number of times. Each object may additionally be rotated along the circle, ensuring orientation of the solid with respect to the center of the circle is maintained."
layout: manual
---

Repeat a 3-dimensional solid some number of times along a partial or complete circle some specified number of times. Each object may additionally be rotated along the circle, ensuring orientation of the solid with respect to the center of the circle is maintained.

```kcl
patternCircular3d(
  @solids: [Solid; 1+],
  instances: number(_),
  axis: Axis3d | Point3d,
  center: Point3d,
  arcDegrees?: number(deg),
  rotateDuplicates?: bool,
  useOriginal?: bool,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid) | The solid(s) to pattern. | Yes |
| `instances` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The axis of the pattern. A 3D vector. | Yes |
| `center` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The center about which to make the pattern. This is a 3D vector. | Yes |
| `arcDegrees` | [`number(deg)`](/docs/kcl-std/types/std-types-number) | "The arc angle to place the repetitions. Must be greater than 0. | No |
| `rotateDuplicates` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether or not to rotate the duplicates as they are copied. | No |
| `useOriginal` | [`bool`](/docs/kcl-std/types/std-types-bool) | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

[`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid)


### Examples

```kcl
// / Pattern using a named axis.


exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
  |> patternCircular3d(
       axis = X,
       center = [10, -20, 0],
       instances = 11,
       arcDegrees = 360,
       rotateDuplicates = true,
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternCircular3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternCircular3d0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternCircular3d0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// / Pattern using a raw axis.


exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
  |> patternCircular3d(
       axis = [1, -1, 0],
       center = [10, -20, 0],
       instances = 11,
       arcDegrees = 360,
       rotateDuplicates = true,
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternCircular3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternCircular3d1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternCircular3d1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


