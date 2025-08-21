---
title: "units::toDegrees"
subtitle: "Function in std::units"
excerpt: "Converts a number to degrees from its current units."
layout: manual
---

Converts a number to degrees from its current units.

```kcl
units::toDegrees(@num: number(Angle)): number(deg)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`number(deg)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 50deg, length = 70 * cos(units::toDegrees((PI / 4): rad)))
  |> yLine(endAbsolute = 0)
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-units-toDegrees0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-units-toDegrees0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


