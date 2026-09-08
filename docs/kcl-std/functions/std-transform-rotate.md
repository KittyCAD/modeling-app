---
title: "rotate"
subtitle: "Function in std::transform"
excerpt: "Rotate a solid, a sketch, or a helix."
layout: manual
---

Rotate a solid, a sketch, or a helix.

```kcl
rotate(
  @objects: [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry,
  roll?: number(Angle),
  pitch?: number(Angle),
  yaw?: number(Angle),
  axis?: Axis3d | Point3d,
  angle?: number(Angle),
  global?: bool,
): [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry
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
| `objects` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] or [[`Helix`](/docs/kcl-std/types/std-types-Helix); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The solid, sketch, helix, or set of solids, sketches, or helices to rotate. | Yes |
| `roll` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The roll angle. | No |
| `pitch` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The pitch angle. | No |
| `yaw` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The yaw angle. | No |
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The axis to rotate around. Must be used with `angle`. | No |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The angle to rotate. Must be used with `axis`. | No |
| `global` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] or [[`Helix`](/docs/kcl-std/types/std-types-Helix); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry)


### Examples

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sweepPath = sketch(on = XZ) {
  line1 = line(start = [var 0.05mm, var 0.05mm], end = [var 0.05mm, var 7.05mm])
  arc2 = arc(start = [var 0.05mm, var 7.05mm], end = [var -4.95mm, var 12.05mm], center = [var -4.95mm, var 7.05mm])
  coincident([line1.end, arc2.start])
  line3 = line(start = [var -4.95mm, var 12.05mm], end = [var -7.95mm, var 12.05mm])
  coincident([arc2.end, line3.start])
  arc4 = arc(start = [var -12.95mm, var 17.05mm], end = [var -7.95mm, var 12.05mm], center = [var -7.95mm, var 17.05mm])
  coincident([line3.end, arc4.end])
  line5 = line(start = [var -12.95mm, var 17.05mm], end = [var -12.95mm, var 24.05mm])
  coincident([arc4.start, line5.start])
}
pipeProfile = sketch(on = XY) {
  outerCircle = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm])
  innerCircle = circle(start = [var 1.5mm, var 0mm], center = [var 0mm, var 0mm])
}
pipeRegion = region(segments = [pipeProfile.outerCircle])
rotated = sweep(pipeRegion, path = sweepPath)
  |> rotate(roll = 10deg, pitch = 10deg, yaw = 90deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the rotate function"
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
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sweepPath = sketch(on = XZ) {
  line1 = line(start = [var 0.05mm, var 0.05mm], end = [var 0.05mm, var 7.05mm])
  arc2 = arc(start = [var 0.05mm, var 7.05mm], end = [var -4.95mm, var 12.05mm], center = [var -4.95mm, var 7.05mm])
  coincident([line1.end, arc2.start])
  line3 = line(start = [var -4.95mm, var 12.05mm], end = [var -7.95mm, var 12.05mm])
  coincident([arc2.end, line3.start])
  arc4 = arc(start = [var -12.95mm, var 17.05mm], end = [var -7.95mm, var 12.05mm], center = [var -7.95mm, var 17.05mm])
  coincident([line3.end, arc4.end])
  line5 = line(start = [var -12.95mm, var 17.05mm], end = [var -12.95mm, var 24.05mm])
  coincident([arc4.start, line5.start])
}
pipeProfile = sketch(on = XY) {
  outerCircle = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm])
  innerCircle = circle(start = [var 1.5mm, var 0mm], center = [var 0mm, var 0mm])
}
pipeRegion = region(segments = [pipeProfile.outerCircle])
rotated = sweep(pipeRegion, path = sweepPath)
  |> rotate(roll = 10deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the rotate function"
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
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sweepPath = sketch(on = XZ) {
  line1 = line(start = [var 0.05mm, var 0.05mm], end = [var 0.05mm, var 7.05mm])
  arc2 = arc(start = [var 0.05mm, var 7.05mm], end = [var -4.95mm, var 12.05mm], center = [var -4.95mm, var 7.05mm])
  coincident([line1.end, arc2.start])
  line3 = line(start = [var -4.95mm, var 12.05mm], end = [var -7.95mm, var 12.05mm])
  coincident([arc2.end, line3.start])
  arc4 = arc(start = [var -12.95mm, var 17.05mm], end = [var -7.95mm, var 12.05mm], center = [var -7.95mm, var 17.05mm])
  coincident([line3.end, arc4.end])
  line5 = line(start = [var -12.95mm, var 17.05mm], end = [var -12.95mm, var 24.05mm])
  coincident([arc4.start, line5.start])
}
pipeProfile = sketch(on = XY) {
  outerCircle = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm])
  innerCircle = circle(start = [var 1.5mm, var 0mm], center = [var 0mm, var 0mm])
}
pipeRegion = region(segments = [pipeProfile.outerCircle])
rotated = sweep(pipeRegion, path = sweepPath)
  |> rotate(axis = Z, angle = 90deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the rotate function"
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

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sweepPath = sketch(on = XZ) {
  line1 = line(start = [var 0.05mm, var 0.05mm], end = [var 0.05mm, var 7.05mm])
  arc2 = arc(start = [var 0.05mm, var 7.05mm], end = [var -4.95mm, var 12.05mm], center = [var -4.95mm, var 7.05mm])
  coincident([line1.end, arc2.start])
  line3 = line(start = [var -4.95mm, var 12.05mm], end = [var -7.95mm, var 12.05mm])
  coincident([arc2.end, line3.start])
  arc4 = arc(start = [var -12.95mm, var 17.05mm], end = [var -7.95mm, var 12.05mm], center = [var -7.95mm, var 17.05mm])
  coincident([line3.end, arc4.end])
  line5 = line(start = [var -12.95mm, var 17.05mm], end = [var -12.95mm, var 24.05mm])
  coincident([arc4.start, line5.start])
}
pipeProfile = sketch(on = XY) {
  outerCircle = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm])
  innerCircle = circle(start = [var 1.5mm, var 0mm], center = [var 0mm, var 0mm])
}
pipeRegion = region(segments = [pipeProfile.outerCircle])
rotated = sweep(pipeRegion, path = sweepPath)
  |> rotate(axis = [0, 0, 1], angle = 90deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the rotate function"
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
  alt="Example showing a rendered KCL program that uses the rotate function"
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
  alt="Example showing a rendered KCL program that uses the rotate function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-rotate6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-rotate6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


