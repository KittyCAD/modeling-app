---
title: "gear::spur"
subtitle: "Function in std::gear"
excerpt: "A spur gear."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

A spur gear.

```kcl
gear::spur(
  nTeeth: number(_),
  module: number(Length),
  pressureAngle: number(Angle),
  gearHeight: number(Length),
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `nTeeth` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `module` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `pressureAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `gearHeight` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Basic example of a spur gear.

@settings(defaultLengthUnit = mm, kclVersion = 1.0, experimentalFeatures = allow)

gear::spur(
  nTeeth = 21,
  module = 1.5,
  pressureAngle = 14deg,
  gearHeight = 6,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gear::spur function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gear-spur0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gear-spur0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


