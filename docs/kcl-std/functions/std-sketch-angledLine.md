---
title: "angledLine"
subtitle: "Function in std::sketch"
excerpt: "Draw a line segment relative to the current origin using the polar measure of some angle and distance."
layout: manual
---

Draw a line segment relative to the current origin using the polar measure of some angle and distance.

```kcl
angledLine(
  @sketch: Sketch,
  angle: number(Angle),
  length?: number(Length),
  lengthX?: number(Length),
  lengthY?: number(Length),
  endAbsoluteX?: number(Length),
  endAbsoluteY?: number(Length),
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Which angle should the line be drawn at? | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Draw the line this distance along the given angle. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given. | No |
| `lengthX` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Draw the line this distance along the X axis. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given. | No |
| `lengthY` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Draw the line this distance along the Y axis. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given. | No |
| `endAbsoluteX` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Draw the line along the given angle until it reaches this point along the X axis. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given. | No |
| `endAbsoluteY` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Draw the line along the given angle until it reaches this point along the Y axis. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> yLine(endAbsolute = 15)
  |> angledLine(angle = 30deg, length = 15)
  |> line(end = [8, -10])
  |> yLine(endAbsolute = 0)
  |> close()

example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-angledLine0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-angledLine0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


