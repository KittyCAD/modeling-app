---
title: "tangentialArc"
subtitle: "Function in std::sketch"
excerpt: "Starting at the current sketch's origin, draw a curved line segment along some part of an imaginary circle until it reaches the desired (x, y) coordinates."
layout: manual
---

Starting at the current sketch's origin, draw a curved line segment along some part of an imaginary circle until it reaches the desired (x, y) coordinates.

```kcl
tangentialArc(
  @sketch: Sketch,
  endAbsolute?: Point2d,
  end?: Point2d,
  radius?: number(Length),
  diameter?: number(Length),
  angle?: number(Angle),
  tag?: TagDecl,
): Sketch
```

When using radius and angle, draw a curved line segment along part of an
imaginary circle. The arc is constructed such that the last line segment is
placed tangent to the imaginary circle of the specified radius. The
resulting arc is the segment of the imaginary circle from that tangent point
for 'angle' degrees along the imaginary circle.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `endAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Which absolute point should this arc go to? Incompatible with `end`, `radius`, and `offset`. | No |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | How far away (along the X and Y axes) should this arc go? Incompatible with `endAbsolute`, `radius`, and `offset`. | No |
| `radius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Radius of the imaginary circle. `angle` must be given. Incompatible with `end` and `endAbsolute` and `diameter`. | No |
| `diameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Diameter of the imaginary circle. `angle` must be given. Incompatible with `end` and `endAbsolute` and `radius`. | No |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Offset of the arc. `radius` must be given. Incompatible with `end` and `endAbsolute`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this arc. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 45deg, length = 10)
  |> tangentialArc(end = [0, -10])
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the tangentialArc function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-tangentialArc0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-tangentialArc0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 60deg, length = 10)
  |> tangentialArc(endAbsolute = [15, 15])
  |> line(end = [10, -15])
  |> close()

example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the tangentialArc function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-tangentialArc1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-tangentialArc1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 60deg, length = 10)
  |> tangentialArc(radius = 10, angle = -120deg)
  |> angledLine(angle = -60deg, length = 10)
  |> close()

example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the tangentialArc function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-tangentialArc2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-tangentialArc2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


