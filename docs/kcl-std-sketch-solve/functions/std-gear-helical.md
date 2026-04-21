---
title: "gear::helical"
subtitle: "Function in std::gear"
excerpt: "A helical gear."
layout: manual
---

A helical gear.

```kcl
gear::helical(
  nTeeth,
  module,
  pressureAngle,
  helixAngle,
  gearHeight,
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `nTeeth` |  |  | Yes |
| `module` |  |  | Yes |
| `pressureAngle` |  |  | Yes |
| `helixAngle` |  |  | Yes |
| `gearHeight` |  |  | Yes |

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


