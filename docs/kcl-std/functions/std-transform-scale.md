---
title: "scale"
subtitle: "Function in std::transform"
excerpt: "Scale a solid or a sketch."
layout: manual
---

Scale a solid or a sketch.

```kcl
scale(
  @objects: [Solid; 1+] | [Sketch; 1+] | ImportedGeometry,
  x?: number(_),
  y?: number(_),
  z?: number(_),
  global?: bool,
): [Solid; 1+] | [Sketch; 1+] | ImportedGeometry
```

This is really useful for resizing parts. You can create a part and then scale it to the
correct size.

For sketches, you can use this to scale a sketch and then loft it with another sketch.

By default the transform is applied in local sketch axis, therefore the origin will not move.

If you want to apply the transform in global space, set `global` to `true`. The origin of the
model will move. If the model is not centered on origin and you scale globally it will
look like the model moves and gets bigger at the same time. Say you have a square
`(1,1) - (1,2) - (2,2) - (2,1)` and you scale by 2 globally it will become
`(2,2) - (2,4)`...etc so the origin has moved from `(1.5, 1.5)` to `(2,2)`.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `objects` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The solid, sketch, or set of solids or sketches to scale. | Yes |
| `x` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The scale factor for the x axis. | No |
| `y` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The scale factor for the y axis. | No |
| `z` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The scale factor for the z axis. | No |
| `global` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry)


### Examples

```kcl
// Scale a pipe.

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
  |> scale(z = 2.5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the scale function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-scale0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-scale0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Scale an imported model.


import "tests/inputs/cube.sldprt" as cube

cube
  |> scale(y = 2.5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the scale function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-scale1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-scale1.png"
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

// Scale the sweep.
scale(parts, z = 0.5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the scale function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-scale2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-scale2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


