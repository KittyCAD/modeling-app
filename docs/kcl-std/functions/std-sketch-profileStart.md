---
title: "profileStart"
subtitle: "Function in std::sketch"
excerpt: "Extract the provided 2-dimensional sketch's profile's origin value."
layout: manual
---

Extract the provided 2-dimensional sketch's profile's origin value.

```kcl
profileStart(@profile: Sketch): Point2d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `profile` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Profile whose start is being used. | Yes |

### Returns

[`Point2d`](/docs/kcl-std/types/std-types-Point2d) - A point in two dimensional space.


### Examples

```kcl
sketch001 = startSketchOn(XY)
  |> startProfile(at = [5, 2])
  |> angledLine(angle = 120deg, length = 50, tag = $seg01)
  |> angledLine(angle = segAng(seg01) + 120deg, length = 50)
  |> line(end = profileStart(%))
  |> close()
  |> extrude(length = 20)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the profileStart function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-profileStart0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-profileStart0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


