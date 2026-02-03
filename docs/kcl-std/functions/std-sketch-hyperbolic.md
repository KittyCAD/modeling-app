---
title: "hyperbolic"
subtitle: "Function in std::sketch"
excerpt: "Add a hyperbolic section to an existing sketch."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Add a hyperbolic section to an existing sketch.

```kcl
hyperbolic(
  @sketch: Sketch,
  semiMajor: number(Length),
  semiMinor: number(Length),
  interiorAbsolute?: Point2d,
  endAbsolute?: Point2d,
  interior?: Point2d,
  end?: Point2d,
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `semiMajor` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The semi major value, a, of the hyperbolic equation x^2 / a ^ 2 - y^2 / b^2 = 1. | Yes |
| `semiMinor` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The semi minor value, b, of the hyperbolic equation x^2 / a ^ 2 - y^2 / b^2 = 1. | Yes |
| `interiorAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Any point between the segment's start and end. Requires `endAbsolute`. Incompatible with `interior` or `end`. | No |
| `endAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where should this segment end? Requires `interiorAbsolute`. Incompatible with `interior` or `end`. | No |
| `interior` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Any point between the segment's start and end. This point is relative to the start point. Requires `end`. Incompatible with `interiorAbsolute` or `endAbsolute`. | No |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where should this segment end? This point is relative to the start point. Requires `interior`. Incompatible with `interiorAbsolute` or `endAbsolute`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this arc. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
@settings(experimentalFeatures = allow)

exampleSketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> hyperbolic(
       end = [10, 0],
       semiMajor = 2,
       semiMinor = 1,
       interior = [0, 0],
     )
  |> close()

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hyperbolic function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-hyperbolic0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-hyperbolic0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


