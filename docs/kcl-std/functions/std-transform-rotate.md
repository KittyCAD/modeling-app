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
| `objects` | [`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid) or [`[Sketch; 1+]`](/docs/kcl-std/types/std-types-Sketch) or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The solid, sketch, or set of solids or sketches to rotate. | Yes |
| `roll` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The roll angle. Must be between -360deg and 360deg. | No |
| `pitch` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The pitch angle. Must be between -360deg and 360deg. | No |
| `yaw` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The yaw angle. Must be between -360deg and 360deg. | No |
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The axis to rotate around. Must be used with `angle`. | No |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The angle to rotate. Must be used with `axis`. Must be between -360deg and 360deg. | No |
| `global` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move. | No |

### Returns

[`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid) or [`[Sketch; 1+]`](/docs/kcl-std/types/std-types-Sketch) or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry)


### Examples

```kcl
// Rotate a pipe with roll, pitch, and yaw.

// Create a path for the sweep.
sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0.05, 0.05])
  |> line(end = [0, 7])
  |> tangentialArc(angle = 90deg, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90deg, radius = 5)
  |> line(end = [0, 7])

// Create a hole for the pipe.
pipeHole = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1.5)

sweepSketch = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> subtract2d(tool = pipeHole)
  |> sweep(path = sweepPath)
  |> rotate(roll = 10, pitch = 10, yaw = 90)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-rotate0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-rotate0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Rotate a pipe with just roll.

// Create a path for the sweep.
sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0.05, 0.05])
  |> line(end = [0, 7])
  |> tangentialArc(angle = 90deg, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90deg, radius = 5)
  |> line(end = [0, 7])

// Create a hole for the pipe.
pipeHole = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1.5)

sweepSketch = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> subtract2d(tool = pipeHole)
  |> sweep(path = sweepPath)
  |> rotate(roll = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-rotate1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-rotate1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Rotate a pipe about a named axis with an angle.

// Create a path for the sweep.
sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0.05, 0.05])
  |> line(end = [0, 7])
  |> tangentialArc(angle = 90deg, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90deg, radius = 5)
  |> line(end = [0, 7])

// Create a hole for the pipe.
pipeHole = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1.5)

sweepSketch = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> subtract2d(tool = pipeHole)
  |> sweep(path = sweepPath)
  |> rotate(axis = Z, angle = 90deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-rotate2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-rotate2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Rotate an imported model.


import "tests/inputs/cube.sldprt" as cube

cube
  |> rotate(axis = [0, 0, 1.0], angle = 9deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-rotate3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-rotate3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Rotate a pipe about a raw axis with an angle.

// Create a path for the sweep.
sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0.05, 0.05])
  |> line(end = [0, 7])
  |> tangentialArc(angle = 90deg, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90deg, radius = 5)
  |> line(end = [0, 7])

// Create a hole for the pipe.
pipeHole = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1.5)

sweepSketch = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> subtract2d(tool = pipeHole)
  |> sweep(path = sweepPath)
  |> rotate(axis = [0, 0, 1.0], angle = 90deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-rotate4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-rotate4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sweep two sketches along the same path.


sketch001 = startSketchOn(XY)
rectangleSketch = startProfile(sketch001, at = [-200, 23.86])
  |> angledLine(angle = 0, length = 73.47, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 50.61)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

circleSketch = circle(sketch001, center = [200, -30.29], radius = 32.63)

sketch002 = startSketchOn(YZ)
sweepPath = startProfile(sketch002, at = [0, 0])
  |> yLine(length = 231.81)
  |> tangentialArc(radius = 80, angle = -90deg)
  |> xLine(length = 384.93)

parts = sweep([rectangleSketch, circleSketch], path = sweepPath)

// Rotate the sweeps.
rotate(parts, axis = [0, 0, 1.0], angle = 90deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-rotate5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-rotate5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Translate and rotate a sketch to create a loft.
sketch001 = startSketchOn(XY)

fn square() {
  return startProfile(sketch001, at = [-10, 10])
    |> xLine(length = 20)
    |> yLine(length = -20)
    |> xLine(length = -20)
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
}

profile001 = square()

profile002 = square()
  |> translate(x = 0, y = 0, z = 20)
  |> rotate(axis = [0, 0, 1.0], angle = 45deg)

loft([profile001, profile002])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-rotate6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-rotate6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


