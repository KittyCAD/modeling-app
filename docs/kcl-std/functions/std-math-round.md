---
title: "round"
subtitle: "Function in std::math"
excerpt: "Round a number to the nearest integer."
layout: manual
---

Round a number to the nearest integer.

```kcl
round(@input: number): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`number`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [12, 10])
  |> line(end = [round(7.02986), 0])
  |> yLine(endAbsolute = 0)
  |> close()

extrude001 = extrude(sketch001, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the round function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-round0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-round0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


