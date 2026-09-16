---
title: "pow"
subtitle: "Function in std::math"
excerpt: "Compute the number to a power."
layout: manual
---

Compute the number to a power.

```kcl
pow(
  @input: number,
  exp: number(_),
): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`number`](/docs/kcl-std/types/std-types-number) | The number to raise. | Yes |
| `exp` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The power to raise to. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 50deg, length = pow(5, exp = 2))
  |> yLine(endAbsolute = 0)
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the pow function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-pow0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-pow0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


