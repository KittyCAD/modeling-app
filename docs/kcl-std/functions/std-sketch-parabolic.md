---
title: "parabolic"
subtitle: "Function in std::sketch"
excerpt: "Add a parabolic segment to an existing sketch."
layout: manual
---

Add a parabolic segment to an existing sketch.

```kcl
parabolic(
  @sketch: Sketch,
  end: Point2d,
  endAbsolute?: Point2d,
  coefficients?: [number; 3],
  interior?: Point2d,
  interiorAbsolute?: Point2d,
  tag?: tag,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where should the path end? Relative to the start point. Incompatible with `interiorAbsolute` or `endAbsolute`. | Yes |
| `endAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where should this segment end? Requires `interiorAbsolute`. Incompatible with `interior` or `end`. | No |
| `coefficients` | [`[number; 3]`](/docs/kcl-std/types/std-types-number) | The coefficients [a, b, c] of the parabolic equation y = ax^2 + bx + c. Incompatible with `interior`. | No |
| `interior` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | A point between the segment's start and end that lies on the parabola. Incompatible with `coefficients` or `interiorAbsolute` or `endAbsolute`. | No |
| `interiorAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Any point between the segment's start and end. Requires `endAbsolute`. Incompatible with `coefficients` or `interior` or `end`. | No |
| `tag` | `tag` | Create a new tag which refers to this segment. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> parabolic(end = [10, 0], coefficients = [2, 0, 0])
  |> close()

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-parabolic0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-parabolic0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


