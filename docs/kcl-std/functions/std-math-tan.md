---
title: "tan"
subtitle: "Function in std::math"
excerpt: "Compute the tangent of a number."
layout: manual
---

Compute the tangent of a number.

```kcl
tan(@num: number(Angle)): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 50deg, length = 50 * tan((1 / 2): number(rad)))
  |> yLine(endAbsolute = 0)
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-tan0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-tan0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


