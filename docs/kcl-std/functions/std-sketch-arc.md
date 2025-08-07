---
title: "arc"
subtitle: "Function in std::sketch"
excerpt: "Draw a curved line segment along an imaginary circle."
layout: manual
---

Draw a curved line segment along an imaginary circle.

```kcl
arc(
  @sketch: Sketch,
  angleStart?: number(Angle),
  angleEnd?: number(Angle),
  radius?: number(Length),
  diameter?: number(Length),
  interiorAbsolute?: Point2d,
  endAbsolute?: Point2d,
  tag?: TagDecl,
): Sketch
```

The arc is constructed such that the current position of the sketch is
placed along an imaginary circle of the specified radius, at angleStart
degrees. The resulting arc is the segment of the imaginary circle from
that origin point to angleEnd, radius away from the center of the imaginary
circle.

Unless this makes a lot of sense and feels like what you're looking
for to construct your shape, you're likely looking for tangentialArc.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `angleStart` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Where along the circle should this arc start? | No |
| `angleEnd` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Where along the circle should this arc end? | No |
| `radius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | How large should the circle be? Incompatible with `diameter`. | No |
| `diameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | How large should the circle be? Incompatible with `radius`. | No |
| `interiorAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Any point between the arc's start and end? Requires `endAbsolute`. Incompatible with `angleStart` or `angleEnd`. | No |
| `endAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where should this arc end? Requires `interiorAbsolute`. Incompatible with `angleStart` or `angleEnd`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this arc. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> arc(angleStart = 0, angleEnd = 280deg, radius = 16)
  |> close()
example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-arc0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-arc0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> arc(endAbsolute = [10, 0], interiorAbsolute = [5, 5])
  |> close()
example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-arc1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-arc1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


