---
title: "patternLinear2d"
subtitle: "Function in std::sketch"
excerpt: "Repeat a 2-dimensional sketch along some dimension, with a dynamic amount of distance between each repetition, some specified number of times."
layout: manual
---

Repeat a 2-dimensional sketch along some dimension, with a dynamic amount of distance between each repetition, some specified number of times.

```kcl
patternLinear2d(
  @sketches: [Sketch; 1+],
  instances: number(_),
  distance: number(Length),
  axis: Axis2d | Point2d,
  useOriginal?: bool,
): [Sketch; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] | The sketch(es) to duplicate. | Yes |
| `instances` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `distance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Distance between each repetition. Also known as 'spacing'. | Yes |
| `axis` | [`Axis2d`](/docs/kcl-std/types/std-types-Axis2d) or [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The axis of the pattern. A 2D vector. | Yes |
| `useOriginal` | [`bool`](/docs/kcl-std/types/std-types-bool) | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

[[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+]


### Examples

```kcl
// / Pattern using a named axis.

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> patternLinear2d(axis = X, instances = 7, distance = 4)

example = extrude(exampleSketch, length = 1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternLinear2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-patternLinear2d0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-patternLinear2d0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// / Pattern using a raw axis.

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> patternLinear2d(axis = [1, 0], instances = 7, distance = 4)

example = extrude(exampleSketch, length = 1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternLinear2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-patternLinear2d1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-patternLinear2d1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


