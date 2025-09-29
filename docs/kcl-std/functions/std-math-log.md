---
title: "log"
subtitle: "Function in std::math"
excerpt: "Compute the logarithm of the number with respect to an arbitrary base."
layout: manual
---

Compute the logarithm of the number with respect to an arbitrary base.

```kcl
log(
  @input: number,
  base: number(_),
): number
```

The result might not be correctly rounded owing to implementation
details; `log2` can produce more accurate results for base 2,
and `log10` can produce more accurate results for base 10.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`number`](/docs/kcl-std/types/std-types-number) | The number to compute the logarithm of. | Yes |
| `base` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The base of the logarithm. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [log(100, base = 5), 0])
  |> line(end = [5, 8])
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the log function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-log0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-log0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


