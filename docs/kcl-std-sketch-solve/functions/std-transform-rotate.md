---
title: "rotate"
subtitle: "Function in std::transform"
excerpt: "Rotate a solid or a sketch."
layout: manual
---

Rotate a solid or a sketch.

```kcl
rotate(
  @objects: [Solid; 1+] | [Sketch; 1+] | ImportedGeometry,
  roll?: number(Angle),
  pitch?: number(Angle),
  yaw?: number(Angle),
  axis?: Axis3d | Point3d,
  angle?: number(Angle),
  global?: bool,
): [Solid; 1+] | [Sketch; 1+] | ImportedGeometry
```

This is really useful for assembling parts together. You can create a part
and then rotate it to the correct orientation.

For sketches, you can use this to rotate a sketch and then loft it with another sketch.

By default, this does a local rotation, around the sketch/body's center.
To rotate around the global scene coordinates, use `global = true`.

### Using Roll, Pitch, and Yaw

When rotating a part in 3D space, "roll," "pitch," and "yaw" refer to the
three rotational axes used to describe its orientation: roll is rotation
around the longitudinal axis (front-to-back), pitch is rotation around the
lateral axis (wing-to-wing), and yaw is rotation around the vertical axis
(up-down); essentially, it's like tilting the part on its side (roll),
tipping the nose up or down (pitch), and turning it left or right (yaw).

So, in the context of a 3D model:

- **Roll**: Imagine spinning a pencil on its tip - that's a roll movement.

- **Pitch**: Think of a seesaw motion, where the object tilts up or down along its side axis.

- **Yaw**: Like turning your head left or right, this is a rotation around the vertical axis

### Using an Axis and Angle

When rotating a part around an axis, you specify the axis of rotation and the angle of
rotation.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `objects` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The solid, sketch, or set of solids or sketches to rotate. | Yes |
| `roll` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The roll angle. Must be between -360deg and 360deg. | No |
| `pitch` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The pitch angle. Must be between -360deg and 360deg. | No |
| `yaw` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The yaw angle. Must be between -360deg and 360deg. | No |
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The axis to rotate around. Must be used with `angle`. | No |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The angle to rotate. Must be used with `axis`. Must be between -360deg and 360deg. | No |
| `global` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry)


### Examples

```kcl
// Rotate an imported model.

import "tests/inputs/cube.sldprt" as cube

cube
  |> rotate(axis = [0, 0, 1.0], angle = 9deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the rotate function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-rotate3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-rotate3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


