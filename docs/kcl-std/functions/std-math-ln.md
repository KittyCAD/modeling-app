---
title: "ln"
subtitle: "Function in std::math"
excerpt: "Compute the natural logarithm of the number."
layout: manual
---

Compute the natural logarithm of the number.

```kcl
ln(@input: number): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`number`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [ln(100), 15])
  |> line(end = [5, -6])
  |> line(end = [-10, -10])
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the ln function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-ln0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-ln0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


