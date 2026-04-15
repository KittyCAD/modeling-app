---
title: "sqrt"
subtitle: "Function in std::math"
excerpt: "Compute the square root of a number."
layout: manual
---

Compute the square root of a number.

```kcl
sqrt(@input: number): number
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
  |> angledLine(angle = 50deg, length = sqrt(2500))
  |> yLine(endAbsolute = 0)
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sqrt function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-sqrt0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-sqrt0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


