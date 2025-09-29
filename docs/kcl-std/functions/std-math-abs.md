---
title: "abs"
subtitle: "Function in std::math"
excerpt: "Compute the absolute value of a number."
layout: manual
---

Compute the absolute value of a number.

```kcl
abs(@input: number): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`number`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
myAngle = -120deg

sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [8, 0])
  |> angledLine(angle = abs(myAngle), length = 5)
  |> line(end = [-5, 0])
  |> angledLine(angle = myAngle, length = 5)
  |> close()

baseExtrusion = extrude(sketch001, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the abs function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-abs0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-abs0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


