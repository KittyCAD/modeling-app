---
title: "gear::ring"
subtitle: "Function in std::gear"
excerpt: "A ring gear (i.e. a gear with internal teeth)."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

A ring gear (i.e. a gear with internal teeth).

```kcl
gear::ring(
  nTeeth: number(_),
  module: number(Length),
  pressureAngle: number(Angle),
  helixAngle: number(Angle),
  gearHeight: number(Length),
): Solid
```

The gear will be placed at (0, 0, 0) in the global scene, and extruded up the Z axis.
Use `translate()` and `rotate()` to move it around once it's created.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `nTeeth` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `module` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `pressureAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `helixAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `gearHeight` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Basic example of a ring gear.

@settings(defaultLengthUnit = mm, kclVersion = 1.0, experimentalFeatures = allow)

gear::ring(
  nTeeth = 40,
  module = 1.5,
  pressureAngle = 14deg,
  helixAngle = -25deg,
  gearHeight = 5,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gear::ring function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gear-ring0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gear-ring0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


