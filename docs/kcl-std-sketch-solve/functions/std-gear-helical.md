---
title: "gear::helical"
subtitle: "Function in std::gear"
excerpt: "A helical gear."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

A helical gear.

```kcl
gear::helical(
  nTeeth: number(_),
  module: number(Length),
  pressureAngle: number(Angle),
  helixAngle: number(Angle),
  gearHeight: number(Length),
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `nTeeth` | `number(_)` | A number. | Yes |
| `module` | `number(Length)` | A number. | Yes |
| `pressureAngle` | `number(Angle)` | A number. | Yes |
| `helixAngle` | `number(Angle)` | A number. | Yes |
| `gearHeight` | `number(Length)` | A number. | Yes |

### Returns

`Solid` - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Basic helical gear example.

@settings(defaultLengthUnit = mm, kclVersion = 1.0, experimentalFeatures = allow)

gearBody = gear::helical(
  nTeeth = 10,
  module = 2,
  pressureAngle = 20deg,
  helixAngle = 35deg,
  gearHeight = 7,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gear::helical function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gear-helical0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gear-helical0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


