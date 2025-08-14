---
title: "log2"
subtitle: "Function in std::math"
excerpt: "Compute the base 2 logarithm of the number."
layout: manual
---

Compute the base 2 logarithm of the number.

```kcl
log2(@input: number): number
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
  |> line(end = [log2(100), 0])
  |> line(end = [5, 8])
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-log20_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-log20.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


