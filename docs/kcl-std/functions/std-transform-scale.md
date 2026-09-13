---
title: "scale"
subtitle: "Function in std::transform"
excerpt: "Scale a solid, a sketch, or a helix."
layout: manual
---

Scale a solid, a sketch, or a helix.

```kcl
scale(
  @objects: [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry,
  x?: number(_),
  y?: number(_),
  z?: number(_),
  global?: bool,
  factor?: number(_),
): [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry
```

This is really useful for resizing parts. You can create a part and then scale it to the
correct size.

For sketches, you can use this to scale a sketch and then loft it with another sketch.

The `x`, `y`, `z`, and `factor` arguments are dimensionless multipliers, not physical
distances. Unlike `translate`, `scale` does not accept a length such as `10mm`. To resize
an object with a known size, divide the target length by the current length. For example,
`targetWidth / seedWidth` produces the dimensionless scale factor for the x axis.

By default the transform is applied in local sketch axis, therefore the origin will not move.

If you want to apply the transform in global space, set `global` to `true`. The origin of the
model will move. If the model is not centered on origin and you scale globally it will
look like the model moves and gets bigger at the same time. Say you have a square
`(1,1) - (1,2) - (2,2) - (2,1)` and you scale by 2 globally it will become
`(2,2) - (2,4)`...etc so the origin has moved from `(1.5, 1.5)` to `(2,2)`.

**NOTE:** Currently,, revolved bodies don't support being scaled in a non-uniform
way (i.e. scaled differently along each axis).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `objects` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] or [[`Helix`](/docs/kcl-std/types/std-types-Helix); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The solid, sketch, helix, or set of solids, sketches, or helices to scale. | Yes |
| `x` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The dimensionless scale factor for the x axis. | No |
| `y` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The dimensionless scale factor for the y axis. | No |
| `z` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The dimensionless scale factor for the z axis. | No |
| `global` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move. | No |
| `factor` | [`number(_)`](/docs/kcl-std/types/std-types-number) | If given, scale the solid by this dimensionless factor. Equivalent to setting `x`, `y` and `z` all to this number. Incompatible with `x`, `y` or `z`. | No |

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
scaled = sweep(pipeRegion, path = sweepPath)
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

```kcl
// Make one button (i.e. just a cylinder)
button1 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1.53)
  |> extrude(length = 1)

// Duplicate it, but use `scale` to make it smaller.
button2 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1.53)
  |> extrude(length = 1)
  |> translate(x = 4)
  // Make it 50% smaller and gold
  |> scale(factor = 0.5)
  |> appearance(color = "#ff9922")

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the scale function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-scale3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-scale3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Resize a 1 mm seed cube to exact physical dimensions.
@settings(kclVersion = 2.0)

seedSize = 1mm
targetWidth = 40mm
targetDepth = 20mm
targetHeight = 10mm

seedSketch = sketch(on = XY) {
  bottom = line(start = [var 0mm, var 0mm], end = [var 1mm, var 0mm])
  right = line(start = [var 1mm, var 0mm], end = [var 1mm, var 1mm])
  top = line(start = [var 1mm, var 1mm], end = [var 0mm, var 1mm])
  left = line(start = [var 0mm, var 1mm], end = [var 0mm, var 0mm])
  coincident([bottom.end, right.start])
  coincident([right.end, top.start])
  coincident([top.end, left.start])
  coincident([left.end, bottom.start])
  horizontal(bottom)
  horizontal(top)
  vertical(right)
  vertical(left)
}
seedRegion = region(segments = [seedSketch.bottom, seedSketch.right])
seedCube = extrude(seedRegion, length = seedSize)

resized = scale(
  seedCube,
  x = targetWidth / seedSize,
  y = targetDepth / seedSize,
  z = targetHeight / seedSize,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the scale function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-scale4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-scale4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


