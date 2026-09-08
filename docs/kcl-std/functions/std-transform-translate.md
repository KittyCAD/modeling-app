---
title: "translate"
subtitle: "Function in std::transform"
excerpt: "Move a solid, a sketch, or a helix."
layout: manual
---

Move a solid, a sketch, or a helix.

```kcl
translate(
  @objects: [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry,
  x?: number(Length),
  y?: number(Length),
  z?: number(Length),
  global?: bool,
  xyz?: [number(Length); 3],
): [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry
```

This is really useful for assembling parts together. You can create a part
and then move it to the correct location.

By default, this does a local translation, around the sketch/body's coordinate system.
To translate around the global scene coordinate system, use `global = true`.

Translate is really useful for sketches if you want to move a sketch
and then rotate it using the `rotate` function to create a loft.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `objects` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] or [[`Helix`](/docs/kcl-std/types/std-types-Helix); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The solid, sketch, helix, or set of solids, sketches, or helices to move. | Yes |
| `x` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount to move the solid or sketch along the x axis. | No |
| `y` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount to move the solid or sketch along the y axis. | No |
| `z` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount to move the solid or sketch along the z axis. | No |
| `global` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move. | No |
| `xyz` | [[`number(Length)`](/docs/kcl-std/types/std-types-number); 3] | If given, interpret this point as 3 distances, along each of [X, Y, Z] and translate by each of them. | No |

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
moved = sweep(pipeRegion, path = sweepPath)
  |> translate(x = 1mm, y = 1mm, z = 2.5mm)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the translate function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-translate0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-translate0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Move an imported model.

import "tests/inputs/cube.sldprt" as cube

// Circle so you actually see the move.
startSketchOn(XY)
  |> circle(center = [-10, -10], radius = 10)
  |> extrude(length = 10)

cube
  |> translate(x = 10.0, y = 10.0, z = 2.5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the translate function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-translate1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-translate1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Move an imported model.

import "tests/inputs/cube.sldprt" as cube

// Circle so you actually see the move.
startSketchOn(XY)
  |> circle(center = [-10, -10], radius = 10)
  |> extrude(length = 10)

cube
  |> translate(xyz = [10.0, 10.0, 2.5])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the translate function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-translate2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-translate2.png"
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
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 50.61)
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

// Move the sweeps.
translate(
  parts,
  x = 1.0,
  y = 1.0,
  z = 2.5,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the translate function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-translate3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-translate3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Move a sketch.

fn square(@length) {
  l = length / 2
  p0 = [-l, -l]
  p1 = [-l, l]
  p2 = [l, l]
  p3 = [l, -l]

  return startSketchOn(XY)
    |> startProfile(at = p0)
    |> line(endAbsolute = p1)
    |> line(endAbsolute = p2)
    |> line(endAbsolute = p3)
    |> close()
}

square(10)
  |> translate(x = 5, y = 5)
  |> extrude(length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the translate function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-translate4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-translate4.png"
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
  |> translate(z = 20)
  |> rotate(axis = [0, 0, 1.0], angle = 45deg)

loft([profile001, profile002])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the translate function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-translate5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-translate5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


