---
title: "translate"
subtitle: "Function in std::transform"
excerpt: "Move a solid or a sketch."
layout: manual
---

Move a solid or a sketch.

```kcl
translate(
  @objects: [Solid; 1+] | [Sketch; 1+] | ImportedGeometry,
  x?: number(Length),
  y?: number(Length),
  z?: number(Length),
  global?: bool,
  xyz?: [number(Length); 3],
): [Solid; 1+] | [Sketch; 1+] | ImportedGeometry
```

This is really useful for assembling parts together. You can create a part
and then move it to the correct location.

Translate is really useful for sketches if you want to move a sketch
and then rotate it using the `rotate` function to create a loft.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `objects` | [`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid) or [`[Sketch; 1+]`](/docs/kcl-std/types/std-types-Sketch) or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The solid, sketch, or set of solids or sketches to move. | Yes |
| `x` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount to move the solid or sketch along the x axis. | No |
| `y` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount to move the solid or sketch along the y axis. | No |
| `z` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount to move the solid or sketch along the z axis. | No |
| `global` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move. | No |
| `xyz` | [`[number(Length); 3]`](/docs/kcl-std/types/std-types-number) | If given, interpret this point as 3 distances, along each of [X, Y, Z] and translate by each of them. | No |

### Returns

[`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid) or [`[Sketch; 1+]`](/docs/kcl-std/types/std-types-Sketch) or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry)


### Examples

```kcl
// Move a pipe.

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
  |> translate(x = 1.0, y = 1.0, z = 2.5)

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


