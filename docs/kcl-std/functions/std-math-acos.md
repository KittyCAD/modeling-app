---
title: "acos"
subtitle: "Function in std::math"
excerpt: "Compute the arccosine of a number."
layout: manual
---

Compute the arccosine of a number.

```kcl
acos(@num: number(_)): number(rad)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`number(rad)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = acos(0.5), length = 10)
  |> line(end = [5, 0])
  |> line(endAbsolute = [12, 0])
  |> close()

extrude001 = extrude(sketch001, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the acos function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-acos0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-acos0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


