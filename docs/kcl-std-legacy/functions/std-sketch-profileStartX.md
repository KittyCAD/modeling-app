---
title: "profileStartX"
subtitle: "Function in std::sketch"
excerpt: "Extract the provided 2-dimensional sketch's profile's origin's 'x' value."
layout: manual
---

Extract the provided 2-dimensional sketch's profile's origin's 'x' value.

```kcl
profileStartX(@profile: Sketch): number(Length)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `profile` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Profile whose start is being used. | Yes |

### Returns

[`number(Length)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
sketch001 = startSketchOn(XY)
  |> startProfile(at = [5, 2])
  |> angledLine(angle = -26.6deg, length = 50)
  |> angledLine(angle = 90deg, length = 50)
  |> angledLine(angle = 30deg, endAbsoluteX = profileStartX(%))

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the profileStartX function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-profileStartX0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-profileStartX0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


