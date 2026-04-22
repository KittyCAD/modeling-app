---
title: "gear::herringbone"
subtitle: "Function in std::gear"
excerpt: "A herringbone gear."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

A herringbone gear.

```kcl
gear::herringbone(
  nTeeth: number(_),
  module: number(Length),
  pressureAngle: number(Angle),
  gearHeight: number(Length),
  helixAngle: number(Angle),
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `nTeeth` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `module` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `pressureAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `gearHeight` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `helixAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Basic herringbone gear example.

@settings(defaultLengthUnit = mm, kclVersion = 1.0, experimentalFeatures = allow)

myGear = gear::herringbone(
  nTeeth = 10,
  module = 2,
  pressureAngle = 20deg,
  gearHeight = 5,
  helixAngle = 40deg,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gear::herringbone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gear-herringbone0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gear-herringbone0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


